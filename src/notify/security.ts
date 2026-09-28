/**
 * @nuln/worker-kit/notify/security
 *
 * SSRF 防御、协议校验、平台长度防爆与敏感字段脱敏工具
 */

import type { NotificationChannelType } from "./types.js";

/* ==================================================== 平台长度防爆 */

/**
 * 各推送平台的单条消息硬限制。
 *
 * 这些数字来自平台公开文档，**不是**我们拍的保守值：
 *
 * | 平台 | 字段 | 限制 | 计量 |
 * | --- | --- | --- | --- |
 * | Telegram Bot API | `text` | 4096 | UTF-8 字符 |
 * | 企业微信机器人 | `markdown.content` | 4096 | UTF-8 字节 |
 * | 企业微信机器人 | `text.content` | 2048 | UTF-8 字节 |
 * | Bark | 整个 payload | 约 4KB | UTF-8 字节 |
 * | 飞书 | 卡片内容 | 20000 | UTF-8 字符 |
 *
 * 超限时平台返回 HTTP 400（`Bad Request: message is too long` 等），
 * 于是**整条告警静默丢失** —— 而丢的往往正是最该看到的那条（几十行异常堆栈）。
 */
export const PLATFORM_LIMITS = {
  telegram: { maxLength: 4096, unit: "char" },
  wecom: { maxLength: 4096, unit: "byte" },
  bark: { maxLength: 4090, unit: "byte" },
  feishu: { maxLength: 20000, unit: "char" },
} as const satisfies Record<string, { maxLength: number; unit: "char" | "byte" }>;

export type PlatformLimitUnit = "char" | "byte";

/** 自闭合 / void 元素，无需补闭合标签 */
const VOID_HTML_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/**
 * 收集一段文本里**尚未闭合**的 HTML 标签，按嵌套逆序返回闭合串。
 *
 * 截断会在任意位置断开文本。如果断点落在 `<b>bold **text**` 中间，
 * 平台会因标签不配对而直接拒绝整条消息（Telegram 尤其严格）——
 * 于是"内容太长"会退化成"内容彻底发不出去"，比截断本身更糟。
 *
 * 之所以按**栈**而不是集合：`<b><i>x` 需要补 `</i></b>` 而非 `</b></i>`，
 * 顺序错了仍然是无效 HTML。
 *
 * @returns 需要追加的闭合标签串；无未闭合标签时返回空串
 */
function unclosedHtmlTags(fragment: string): string {
  const stack: string[] = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(fragment)) !== null) {
    const [, closing, nameRaw, selfClose] = m;
    const name = nameRaw!.toLowerCase();
    if (VOID_HTML_TAGS.has(name) || selfClose === "/") continue;
    if (closing === "/") {
      // 找到最近的同名开标签；找不到说明这段本来就是坏的，不做修复
      const at = stack.lastIndexOf(name);
      if (at !== -1) stack.length = at;
    } else {
      stack.push(name);
    }
  }
  return stack
    .slice()
    .reverse()
    .map((n) => `</${n}>`)
    .join("");
}

/**
 * 补齐被截断文本里**奇数个**的 Markdown 围栏。
 *
 * 单个反引号与三反引号代码块分别计数：代码块未闭合会让后续所有内容
 * 被当作代码渲染，在 Telegram / WeCom 上表现为一大坨等宽字。
 *
 * @returns 需要追加的围栏；配平则返回空串
 */
function unclosedMarkdownFences(fragment: string): string {
  const fences = fragment.match(/^```/gm)?.length ?? 0;
  let out = fences % 2 === 1 ? "```" : "";
  // 去掉围栏占用的反引号后再判断行内单反引号
  const inline = (fragment.replace(/^```[\s\S]*?^```/gm, "")).match(/(?<!`)`(?!`)/g)?.length ?? 0;
  if (inline % 2 === 1) out += "`";
  return out;
}

/**
 * 按平台上限安全截断文本，并修复截断造成的标记不配对。
 *
 * ## 为什么不能直接 `slice`
 *
 * 三个独立的坑：
 *
 * 1. **多字节字符**。`"中文"` 按字节算 6，按字符算 2。按字符切到 max 附近时，
 *    字节数仍可能超限；按字节硬切则会把一个 UTF-8 序列劈成两半，
 *    产出非法字符（替换符 U+FFFD），在部分平台上会触发 400。
 * 2. **代理对**。`slice` 按 UTF-16 code unit 切，emoji / 部分 CJK 扩展字
 *    占 2 个 code unit，切在中间得到孤立代理项。
 * 3. **标记不配对**。断在标签或代码块中间 → 平台拒绝整条消息。
 *
 * ## 截断后缀的预算
 *
 * 截断结果**包含**后缀与闭合标签，即二者都计入上限 —— 否则
 * "截断到刚好 4096，再补上 20 字符后缀" 依然是超限的。
 *
 * @param text 原始文本
 * @param maxLength 上限，按 `unit` 计量
 * @param suffix 截断标记；传空串则不追加。默认 `...[truncated]`
 * @param unit 计量方式：`char` 按 Unicode 码点，`byte` 按 UTF-8 字节
 * @returns 长度合规且标记配对的文本；未超限时**原样返回**（不做多余修复）
 */
export function truncateForPlatform(
  text: string,
  maxLength: number,
  suffix: string = "...[truncated]",
  unit: PlatformLimitUnit = "char",
): string {
  const src = String(text ?? "");
  if (maxLength <= 0) return "";

  // 未超限则原样返回：内容本就配对，任何"修复"都是无谓的改动
  if (measure(src, unit) <= maxLength) return src;

  // 预算 = 上限 − 后缀 − 修复开销。
  //
  // 修复开销无法事先精确知道（取决于截断点落在哪几个标签里），
  // 但**必须预留**：`body = 上限 − 后缀` 时，加上闭合标签必然超限，
  // 而超限的整条消息会被平台直接丢弃 —— 那比截断更糟。
  //
  // 预留 32 个字符足以容纳 8 层嵌套（`</div>` 约 5 字符/层）加上零散围栏；
  // 更深的嵌套由下面的收紧循环兜底。
  const REPAIR_RESERVE = 32;
  const bodyBudget = Math.max(0, maxLength - measure(suffix, unit) - REPAIR_RESERVE);

  let body = sliceTo(src, bodyBudget, unit);
  // 逐轮收紧正文，直到「正文 + 后缀 + 修复」整体装得下。
  // 每轮砍 8 个字符：足够快，又不至于把内容砍得只剩后缀。
  for (let i = 0; i < 32; i++) {
    const candidate = body + suffix + unclosedHtmlTags(body) + unclosedMarkdownFences(body);
    if (measure(candidate, unit) <= maxLength) return candidate;
    const next = sliceTo(body, Math.max(0, [...body].length - 8), "char");
    if (next === body) break; // 已砍无可砍
    body = next;
  }
  // 兜底：正文在当前上限下连一个字符都放不下（上限 < 后缀长度），
  // 此时只保留能放下的部分，宁可内容全丢也不能让整条消息超限。
  return sliceTo(suffix, maxLength, unit);
}

/** 按码点或 UTF-8 字节计量文本长度 */
function measure(text: string, unit: PlatformLimitUnit): number {
  if (unit === "char") return [...text].length;
  return new TextEncoder().encode(text).length;
}

/**
 * 在不超过 `limit`（按 `unit`）的前提下尽量多地保留前缀。
 *
 * 切分以 **code point** 为最小单位（`Array.from`），因此不会把 emoji
 * 或 CJK 扩展字劈成孤立代理项；按字节计量时逐点累加其 UTF-8 长度，
 * 因此也不会在多字节序列中间断开。
 */
function sliceTo(text: string, limit: number, unit: PlatformLimitUnit): string {
  if (limit <= 0) return "";
  if (unit === "char") return [...text].slice(0, limit).join("");

  const enc = new TextEncoder();
  let bytes = 0;
  let out = "";
  // 逐 code point 累加，天然避开代理对截断
  for (const ch of text) {
    const cost = enc.encode(ch).length;
    if (bytes + cost > limit) break;
    bytes += cost;
    out += ch;
  }
  return out;
}

/**
 * 校验给定的 URL 是否为合法的公共安全 URL（防 SSRF）
 * 拦截内网 IP、Loopback（127.0.0.1 / localhost）、Link-Local、保留地址与非 HTTPS
 */
export function assertSafePublicUrl(rawUrl: string, allowHttpForTesting = false): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("Invalid URL format");
  }

  if (parsed.protocol !== "https:") {
    if (parsed.protocol === "http:" && allowHttpForTesting) {
      // allow
    } else {
      throw new Error("Only HTTPS endpoints are permitted");
    }
  }

  const hostname = parsed.hostname.toLowerCase();

  // 1. Loopback & Localhost
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal"
  ) {
    if (!allowHttpForTesting) {
      throw new Error("Target address is not permitted (Private/Loopback IP blocked)");
    }
  }

  // 2. IPv4 Private & Link-Local Ranges
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, o1, o2] = ipv4Match.map(Number);
    // 10.0.0.0/8
    if (o1 === 10) throw new Error("Target address is not permitted (Private/Loopback IP blocked)");
    // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    if (o1 === 172 && o2 >= 16 && o2 <= 31) {
      throw new Error("Target address is not permitted (Private/Loopback IP blocked)");
    }
    // 192.168.0.0/16
    if (o1 === 192 && o2 === 168) {
      throw new Error("Target address is not permitted (Private/Loopback IP blocked)");
    }
    // 169.254.0.0/16 (Link-Local / Cloud Metadata)
    if (o1 === 169 && o2 === 254) {
      throw new Error("Target address is not permitted (Private/Loopback IP blocked)");
    }
    // 127.0.0.0/8 (Loopback IPv4)
    if (o1 === 127 && !allowHttpForTesting) {
      throw new Error("Target address is not permitted (Private/Loopback IP blocked)");
    }
    // 0.0.0.0/8
    if (o1 === 0 && !allowHttpForTesting) {
      throw new Error("Target address is not permitted (Private/Loopback IP blocked)");
    }
  }

  return parsed;
}

/**
 * 脱敏字符串辅助函数（保留前 4 位和后 4 位，中间打码）
 */
export function maskSecret(secret: string): string {
  if (!secret) return "";
  const s = String(secret).trim();
  if (s.length <= 8) return "********";
  return `${s.slice(0, 4)}***${s.slice(-4)}`;
}

/**
 * 对通道配置进行脱敏处理，防止前端回显或日志泄露敏感 Token
 */
export function maskChannelConfig(
  channel: NotificationChannelType,
  config: Record<string, any>
): Record<string, any> {
  if (!config || typeof config !== "object") return {};
  const masked: Record<string, any> = { ...config };

  switch (channel) {
    case "telegram":
      if (typeof masked.botToken === "string") {
        masked.botToken = maskSecret(masked.botToken);
      }
      break;
    case "bark":
      if (typeof masked.deviceKey === "string") {
        masked.deviceKey = maskSecret(masked.deviceKey);
      }
      break;
    case "feishu":
      if (typeof masked.secret === "string") {
        masked.secret = maskSecret(masked.secret);
      }
      masked.webhookUrl = maskWebhookUrl(masked.webhookUrl);
      break;
    case "webhook":
      if (typeof masked.secret === "string") {
        masked.secret = maskSecret(masked.secret);
      }
      if (typeof masked.token === "string") {
        masked.token = maskSecret(masked.token);
      }
      break;
    case "wecom":
      masked.webhookUrl = maskWebhookUrl(masked.webhookUrl);
      break;
    case "email":
    default:
      break;
  }

  return masked;
}

/**
 * 对机器人 Webhook URL 做凭据感知的脱敏。
 *
 * ## 为什么必须单独处理 URL
 *
 * 企业微信与飞书的**真正凭据就藏在 URL 里**：
 * - 企微：`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<机器人密钥>`
 * - 飞书：`https://open.feishu.cn/open-apis/bot/v2/hook/<bot-token>`（在**路径末段**）
 *
 * 历史实现的 `maskChannelConfig` 只处理 `secret` 字段，`webhookUrl` 从未被脱敏
 * （`wecom` 甚至整个 switch 都没有对应 case，落入 `default: break`）。该函数的
 * 唯一用途正是管理后台回显，于是完整机器人密钥连同 `?key=` 一起出现在前端 JSON
 * 响应与浏览器 devtools 中。拿到该 URL 即可**以企业身份向任意群发任意消息**。
 *
 * 脱敏策略：保留 origin 与路径的**非凭据前缀**，把凭据部分替换为掩码 ——
 * - 企微：把 `key` 查询参数值替换为掩码
 * - 通用：把路径**最后一段**替换为掩码（飞书 token 即在末段）
 *
 * @param raw 原始 URL；非字符串或无法解析时原样返回
 */
function maskWebhookUrl(raw: unknown): unknown {
  if (typeof raw !== "string" || !raw) return raw;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "••••";
  }

  // 显式凭据型查询参数（企微 key、飞书 sign 等）
  for (const key of [...u.searchParams.keys()]) {
    if (/^(key|token|secret|sign|sign_token)$/i.test(key)) {
      u.searchParams.set(key, "••••");
    }
  }

  // 路径末段常为凭据（飞书 /hook/<bot-token>、Slack /services/xxx）
  const segments = u.pathname.split("/").filter(Boolean);
  if (segments.length > 0) {
    const last = segments[segments.length - 1];
    // 仅当末段"看起来像凭据"（足够长且非纯路径标识）才脱敏，
    // 避免把 /cgi-bin/webhook/send 这类固定路径也打码，降低可读性
    if (last.length >= 16) {
      segments[segments.length - 1] = "••••";
    }
    u.pathname = "/" + segments.join("/");
  }

  return u.toString();
}

/**
 * 智能合并新旧配置：如果前端提交的字段包含脱敏占位符（如 '***' 或 '****'），则保留原有的真实敏感值
 */
export function mergeChannelConfig(
  existingConfig: Record<string, any> | undefined | null,
  newConfig: Record<string, any>,
  channel?: NotificationChannelType,
): Record<string, any> {
  if (!existingConfig || typeof existingConfig !== "object") {
    return { ...newConfig };
  }
  const merged: Record<string, any> = { ...newConfig };

  // 传入 channel 时，只对**已知敏感字段**应用占位符回填。
  // 历史实现对所有字符串字段生效，用户提交的合法值只要恰好包含 `***`
  // （邮件模板、含星号的 URL 等）就会被静默丢弃并保留旧值。
  // 不传 channel 时保持旧的全字段行为（向后兼容）。
  const sensitive = channel ? SENSITIVE_FIELDS[channel] : null;
  const scope = sensitive ? new Set(sensitive) : null;

  for (const [key, val] of Object.entries(newConfig)) {
    if (scope && !scope.has(key)) continue;
    if (typeof val === "string" && (val.includes("***") || val === "********")) {
      if (existingConfig[key] !== undefined) {
        merged[key] = existingConfig[key];
      }
    }
  }

  return merged;
}

/** 各渠道的敏感字段名（用于限定占位符回填范围）。 */
const SENSITIVE_FIELDS: Record<string, string[]> = {
  telegram: ["botToken"],
  bark: ["deviceKey"],
  feishu: ["secret", "webhookUrl"],
  webhook: ["secret", "token"],
  wecom: ["webhookUrl"],
  email: ["password", "apiKey"],
};
