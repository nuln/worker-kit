/**
 * @nuln/worker-kit/notify/drivers/feishu
 */

import type { NotificationPayload, FeishuConfig, SendResult } from "../types.js";
import { PLATFORM_LIMITS, assertSafePublicUrl, truncateForPlatform } from "../security.js";
import { formatToFeishuCard } from "../formatters.js";

async function genFeishuSign(secret: string, timestamp: number): Promise<string> {
  const stringToSign = `${timestamp}\n${secret}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(stringToSign),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new Uint8Array(0));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

export async function sendFeishu(
  config: FeishuConfig,
  payload: NotificationPayload
): Promise<SendResult> {
  const { webhookUrl, secret } = config;

  if (!webhookUrl) {
    return { ok: false, channel: "feishu", error: "webhookUrl is required" };
  }

  try {
    assertSafePublicUrl(webhookUrl);
  } catch (err: any) {
    return { ok: false, channel: "feishu", error: `Invalid Feishu webhook URL: ${err.message}` };
  }

  if (
    (typeof process !== "undefined" && process.env?.MOCK_EXTERNAL_API === "true")
  ) {
    return { ok: true, channel: "feishu", messageId: `feishu_mock_${Date.now()}` };
  }

  // 飞书卡片内容上限约 20000 字符。超限时接口返回
  // {"code": 19021, "msg": "card content exceed max length"}。
  //
  // 卡片是**结构化 JSON**而非纯文本，直接对 JSON 字符串截断会破坏结构。
  // 因此改为先压平正文（`formatToFeishuCard` 的文本来源）再构造卡片 ——
  // 但 cardPayload 已经生成，所以这里退一步：截断各文本字段。
  const limit = PLATFORM_LIMITS.feishu;
  const cardPayload = formatToFeishuCard(
    truncateFeishuTextFields(payload, limit.maxLength),
  );

  if (secret && secret.trim()) {
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = await genFeishuSign(secret, timestamp);
    cardPayload.timestamp = String(timestamp);
    cardPayload.sign = sign;
  }

  // 出站请求加固：5s 超时 + 禁止自动跟随重定向。
  // 默认的 `redirect: "follow"` 会让公网 URL 返回 302 跳到内网地址，
  // 使 assertSafePublicUrl 的 SSRF 首跳校验形同虚设（该检查只作用于首跳 URL）。
  const outboundSignal = AbortSignal.timeout(5000);
  // 出站请求必须整体包在 try/catch 内：DNS 失败 / 连接被拒 / 超时会让 fetch
  // 的 Promise reject，若不捕获，异常会冒泡到调用方。
  //
  // 消费侧通常写成 `notify.sendX(...).then(res => { err = res.ok ? null : res.error })`：
  // reject 时 then 回调根本不执行，err 保持初始值（成功语义），外层再 `.catch(()=>{})`
  // 吞掉 —— 最终**网络故障被上报为「告警投递成功」**。这是最坏的一类 fail-open：
  // 告警系统自己静默失效且无任何信号。
  let res: Response;
  try {
    res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cardPayload),
    signal: outboundSignal,
    redirect: "manual",
  });
  } catch (err) {
    return {
      ok: false,
      channel: "feishu",
      error: `网络请求失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return {
      ok: false,
      channel: "feishu",
      error: `Feishu API HTTP error (${res.status}): ${errText}`,
    };
  }

  // 解析失败判为失败（此前 `.catch(() => ({}))` 会让「返回 HTML 错误页」被
  // 当作投递成功，告警静默丢失）
  const data: any = await res.json().catch(() => null);
  if (!data || typeof data !== "object") {
    return { ok: false, channel: "feishu", error: "Feishu 返回了非 JSON 响应体" };
  }
  // 业务字段**缺失**同样判失败（与 bark / wecom / telegram 同一口径）。
  //
  // 原判定里 `data?.code !== undefined` 写在最后：HTTP 200、响应体为 `{}` 时
  // 整个条件为假 → 落到成功分支，把异常响应当成投递成功。
  // 飞书成功响应必然带 code:0 或 StatusCode:0，故要求字段存在是安全的。
  const hasCode = data?.code !== undefined || data?.StatusCode !== undefined;
  if (!hasCode || (data.code !== 0 && data.StatusCode !== 0)) {
    return {
      ok: false,
      channel: "feishu",
      error: `Feishu API rejected (${data.code}): ${data.msg || data.error}`,
    };
  }

  return { ok: true, channel: "feishu", messageId: `feishu_${Date.now()}` };
}

/**
 * 飞书卡片的文本字段各自独立超限时，按上限压平后再构造卡片。
 *
 * 卡片是结构化 JSON，直接对序列化结果截断会把 JSON 截成非法片段
 * （接口报 400 且看不出原因）。所以必须在**字段层面**收敛。
 *
 * 标题与正文按 1:4 分配预算：正文通常是异常堆栈，占大头。
 *
 * @param payload 原始通知载荷
 * @param max 单字段字符上限（飞书按字符计）
 */
function truncateFeishuTextFields(
  payload: NotificationPayload,
  max: number,
): NotificationPayload {
  const bodyBudget = Math.floor(max * 0.8);
  const titleBudget = max - bodyBudget;
  return {
    ...payload,
    title: truncateForPlatform(payload.title, titleBudget, "…", "char"),
    message: truncateForPlatform(
      payload.message,
      bodyBudget,
      "\n\n[Content truncated due to platform size limit]",
      "char",
    ),
  };
}
