/**
 * @nuln/worker-kit/urls — Origin / URL 安全原语
 *
 * ## 为什么抽出这个模块
 *
 * 这些原语此前在 `sso/index.ts` 与 `urls/index.ts` 中**各有一份逐字相同的实现**：
 * 14 个导出符号重复，其中 `resolveIssuer`(50 行)、`isSafeNextUrl`（开放重定向
 * 防护）、`normalizeOrigin` / `normalizeIssuerUrl`（拒绝 URL userinfo，挡住
 * `https://trusted.com@evil.com` 混淆）等安全关键函数完全一致。
 *
 * 双副本意味着**安全修复只需改一处就会静默失守另一处** —— 历史上
 * `fix(sso): reject userinfo in isSafeNextUrl` 正是这种形态的补丁。
 * 现收敛为单一实现，`sso` 与 `urls` 均从此处再导出。
 *
 * 本模块的语义分类：
 * - 归一化：`normalizeOrigin` / `normalizeIssuerUrl` / `normalizeRedirectUri` / `normalizeSubPath`
 * - 白名单：`parseOriginAllowlist` / `assertSsoOrigin` / `isRedirectUriAllowed` / `selectRpId`
 * - 解析：`resolveIssuer` / `resolveOidcIssuer` / `isLoopbackHostname` / `isSafeNextUrl`
 *
 * @packageDocumentation
 */

export interface IssuerEnv {
  AUTH_SERVER_URL?: string;
  ORIGIN?: string;
  ALLOWED_ORIGINS?: string;
  RP_ID?: string;
  ENVIRONMENT?: string;
  DEV_MODE?: string;
}

/** 归一化 Origin（仅保留 scheme://host[:port]）。 */
export function normalizeOrigin(origin: string): string {
  const u = new URL(String(origin ?? "").trim());
  if (u.username || u.password) throw new Error("invalid_origin_userinfo");
  u.hash = "";
  u.search = "";
  return u.origin;
}

/** 是否为本地回环或局域网 IP（localhost / 127.0.0.0/8 / ::1 / 192.168.x / 10.x / 172.16-31.x）。 */
export function isLoopbackHostname(hostname: string): boolean {
  const h = String(hostname ?? "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  // 私网段必须匹配**完整 IPv4 字面量**，不能只锚定前缀。
  //
  // 原先的 `/^127\./` 会让 `127.evil.com`、`127.0.0.1.evil.com` 都被判为回环 ——
  // 而本函数是 `normalizeRedirectUri` 里"允许 http:// 回调"的唯一依据。
  // 于是攻击者只要注册一个形如 `127.<任意>.com` 的域名，
  // 就能让明文 http 重定向 URI 通过校验。
  const ipv4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
  return (
    h === "localhost" ||
    h === "::1" ||
    (ipv4.test(h) &&
      (/^127\./.test(h) ||
        /^10\./.test(h) ||
        /^192\.168\./.test(h) ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)))
  );
}

/** 归一化子路径（如 "/oidc"），空或 "/" 返回 ""。 */
export function normalizeSubPath(p: string | undefined | null): string {
  const clean = `/${String(p ?? "").trim()}`.replace(/\/+/g, "/").replace(/\/+$/, "");
  return clean === "/" ? "" : clean;
}

/** 归一化完整 Issuer URL（保全合法 pathname，去除尾斜杠与 query/hash）。 */
export function normalizeIssuerUrl(urlStr: string): string {
  const u = new URL(String(urlStr ?? "").trim());
  if (u.username || u.password) throw new Error("invalid_issuer_userinfo");
  if (u.protocol !== "https:" && !isLoopbackHostname(u.hostname)) {
    throw new Error("invalid_issuer_protocol: must be https or loopback");
  }
  return `${u.origin}${normalizeSubPath(u.pathname)}`;
}

/** 解析 Origin 白名单 CSV（可选注入默认可信 origin，去重）。 */
export function parseOriginAllowlist(
  csv: string | undefined,
  defaultOrigin?: string,
): string[] {
  const raw = String(csv ?? "").trim();
  if (raw === "*") return ["*"];
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((x) => {
      try {
        return normalizeOrigin(x);
      } catch {
        return x;
      }
    });
  if (defaultOrigin) {
    try {
      list.push(normalizeOrigin(defaultOrigin));
    } catch {
      // 忽略非法默认值，由后续校验拦截
    }
  }
  return [...new Set(list)];
}

/**
 * 动态解析当前请求的 OIDC Issuer URL (IdP 侧)。
 * 1. 显式绝对 URL（单域/集中模式）：保全子路径直接使用，但请求 Host 仍须过白名单；
 * 2. 相对路径或未配置：按白名单动态派生 `${origin}${base}`；
 * 3. 未命中白名单直接抛错（fail-closed），绝不反射未知 Host。
 */
export function resolveIssuer(
  reqUrl: string,
  env: IssuerEnv,
  basePath: string,
): string {
  const url = new URL(reqUrl);
  const requestOrigin = normalizeOrigin(url.origin);
  const configured = (env.AUTH_SERVER_URL ?? "").trim();
  const isAbsoluteConfig = !!configured && !configured.startsWith("/");
  let defaultTrustedOrigin: string | undefined;
  if (isAbsoluteConfig) {
    try {
      defaultTrustedOrigin = new URL(configured).origin;
    } catch {
      defaultTrustedOrigin = undefined;
    }
  }
  const allowedOrigins = [
    ...parseOriginAllowlist(env.ORIGIN, defaultTrustedOrigin),
    ...parseOriginAllowlist(env.ALLOWED_ORIGINS),
  ];
  const rpIDs = (env.RP_ID || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const cleanHost = url.hostname.toLowerCase();
  const matchesRpID = rpIDs.some((id) => cleanHost === id || cleanHost.endsWith("." + id));

  // 开发模式豁免的三个条件，**都要求请求 host 本身是回环地址**。
  //
  // 历史实现是 `isDev ||`，其中 isDev 只看环境变量、不看请求 host。后果：生产
  // 环境一旦遗留 `DEV_MODE=true`（或 ENVIRONMENT=development），任意 Host 都
  // 通过校验 —— 攻击者发 `Host: evil.com`，issuer 被解析为 `https://evil.com/oidc`，
  // OIDC discovery 与 `iss` 校验随之漂移，构成典型的 issuer 混淆 /
  // authorization-code 注入的前置条件。
  //
  // 现在环境变量只作为**必要条件**之一，仍要求请求确实来自本地回环；
  // 这样"线上误留开发开关"不再等于"全站校验关闭"。
  const isLoopbackRequest = isLoopbackHostname(url.hostname);
  const devEnvRequested =
    env.ENVIRONMENT === "development" ||
    env.DEV_MODE === "true" ||
    (isAbsoluteConfig && defaultTrustedOrigin
      ? isLoopbackHostname(new URL(defaultTrustedOrigin).hostname)
      : false);
  const isDevRequest = devEnvRequested && isLoopbackRequest;

  const isAllowed =
    isDevRequest ||
    allowedOrigins.includes("*") ||
    isLoopbackRequest ||
    matchesRpID ||
    allowedOrigins.includes(requestOrigin);

  if (!isAllowed) {
    throw new Error(`invalid_host: ${requestOrigin} not in ORIGIN allowlist`);
  }
  if (isAbsoluteConfig) {
    return normalizeIssuerUrl(configured);
  }
  const relativeBase = configured.startsWith("/") ? configured : "";
  const effectiveBase = normalizeSubPath(basePath || relativeBase || "/oidc");
  return `${requestOrigin}${effectiveBase}`;
}

/** 归一化回调地址（WHATWG 标准；仅 https，回环例外；拒绝 userinfo/fragment）。 */
export function normalizeRedirectUri(uri: string): string {
  const u = new URL(String(uri ?? "").trim());
  if (u.username || u.password) throw new Error("invalid_redirect_uri_userinfo");
  if (u.hash) throw new Error("invalid_redirect_uri_fragment");
  if (u.protocol !== "https:" && !isLoopbackHostname(u.hostname)) {
    throw new Error("invalid_redirect_uri_scheme");
  }
  return u.toString();
}

/**
 * 多回调白名单精确匹配：支持 JSON 数组与空格/换行分隔两种存储格式，
 * 双方均经 normalizeRedirectUri 规范化后全等比较。
 */
export function isRedirectUriAllowed(
  clientRedirectUris: string,
  requestedUri: string,
): boolean {
  let requested: string;
  try {
    requested = normalizeRedirectUri(requestedUri);
  } catch {
    return false;
  }
  let allowedList: string[];
  const raw = String(clientRedirectUris ?? "");
  try {
    const parsed: unknown = JSON.parse(raw);
    allowedList = Array.isArray(parsed) ? parsed.map(String) : raw.split(/[\r\n\s,]+/);
  } catch {
    allowedList = raw.split(/[\r\n\s,]+/);
  }
  allowedList = allowedList.map((s) => s.trim()).filter(Boolean);
  return allowedList.some((candidate) => {
    try {
      return normalizeRedirectUri(candidate) === requested;
    } catch {
      return false;
    }
  });
}

/**
 * RP_ID 选择算法：精确匹配优先，否则注册后缀匹配（带点边界）取最长，
 * 均未命中抛错。IPv6/IP 字面量仅精确命中。
 */
export function selectRpId(hostname: string, rpIds: string[]): string {
  const raw = String(hostname ?? "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  const host = raw.split(":")[0];
  const cands = (rpIds ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const exact = cands.find((r) => r === host);
  if (exact) return exact;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) {
    throw new Error(`invalid_rp_id: ip literal must match exactly (${host})`);
  }
  const suffix = cands
    .filter((r) => host.endsWith(`.${r}`))
    .sort((a, b) => b.length - a.length)[0];
  if (suffix) return suffix;
  throw new Error(`invalid_rp_id: no matching RP_ID for ${host}`);
}

/**
 * 断言请求 Origin 在白名单内 (SP 侧 fail-closed)。
 *
 * ## 安全语义
 *
 * 回环/内网放行是**开发便利**，不是安全策略，因此必须置于「未配置白名单」
 * 之后：
 *
 * 1. 白名单已配置（含通配 `*`）→ 一律按白名单判定，**不做任何回环豁免**。
 * 2. 白名单未配置 → 仅当请求 host 属于回环/内网时放行（本地开发零配置）；
 *    否则抛 `missing_config`。
 *
 * 历史实现把 `isLoopbackHostname` 检查放在白名单判定**之前**且无条件返回，
 * 与本函数的文档承诺相反：即使已配置严格白名单，`Host: localhost`、
 * `10.x` / `192.168.x` / `172.16-31.x` 依然被放行，导致
 * `resolveOidcRedirectUri` / `resolveOidcIssuer` 从伪造主机推导 issuer。
 *
 * @param requestUrl 完整请求 URL
 * @param allowedOriginsCsv 逗号分隔的允许 Origin 列表；`"*"` 表示全部放行
 * @returns 通过校验的 Origin（已归一化）
 * @throws 白名单未配置且请求非本地回环（`missing_config`），或 Origin 不在白名单（`invalid_sso_host`）
 */
export function assertSsoOrigin(
  requestUrl: string,
  allowedOriginsCsv: string | undefined,
): string {
  const url = new URL(requestUrl);
  const origin = normalizeOrigin(url.origin);
  const allowed = parseOriginAllowlist(allowedOriginsCsv);

  // 白名单已显式配置（含通配）→ 按白名单判定，不给回环/内网任何豁免
  if (allowed.length > 0) {
    if (allowed.includes("*")) return origin;
    if (!allowed.includes(origin)) {
      throw new Error(`invalid_sso_host: ${origin} not in ALLOWED_SSO_ORIGINS`);
    }
    return origin;
  }

  // 未配置白名单：仅本地回环/内网放行，其余 fail-closed
  if (isLoopbackHostname(url.hostname)) return origin;
  throw new Error(
    "missing_config: ALLOWED_SSO_ORIGINS must be configured in production",
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 以下原语此前只存在于 urls/index.ts（sso 侧同名但签名不同），一并收敛
// ────────────────────────────────────────────────────────────────────────────

/**
 * 判断 `next` 是否为安全的站内跳转地址（**非抛出**变体）。
 *
 * ## 威胁模型：开放重定向
 *
 * `next` 完全由查询参数控制。若不校验，攻击者可构造
 * `?next=https://evil.com` 骗取用户在钓鱼页登录，凭证落入攻击者站点。
 *
 * 三重校验：
 * 1. 解析后 `target.origin` 必须等于当前 origin（挡 `//evil.com`、
 *    `https://app@evil.com`、WHATWG 归一化后的 `/\evil.com`）
 * 2. 拒绝含 userinfo 的 URL（`https://trusted.com@evil.com` 混淆）
 * 3. pathname 必须等于 `basePath` 或以 `basePath + "/"` 开头
 *    （点号/斜杠边界：`/towerx` 不得匹配 `/tower`）
 *
 * @param next 待校验的跳转目标，可为相对路径
 * @param origin 当前站点的 origin
 * @param basePath 服务路由前缀，如 `/tower`；空串表示根路径部署
 * @returns 是否安全可跳转
 */
export function isSafeNextUrl(
  next: string | null | undefined,
  origin: string,
  basePath: string,
): boolean {
  if (!next || !next.trim()) return false;
  try {
    const target = new URL(next.trim(), origin);
    if (target.origin !== origin) return false;
    if (target.username || target.password) return false;
    const cleanBase = normalizeSubPath(basePath);
    if (!cleanBase) return true;
    return target.pathname === cleanBase || target.pathname.startsWith(`${cleanBase}/`);
  } catch {
    return false;
  }
}

/** 兼容别名：动态解析 OIDC Issuer。 */
export const resolveOidcIssuer = resolveIssuer;

/**
 * 判断某 Origin 是否在允许列表内（**非抛出**变体）。
 *
 * ## 与 {@link assertSsoOrigin} 的区别
 *
 * 历史上 `urls/index.ts` 有一个**同名但签名完全不同**的 `assertSsoOrigin`：
 * - 本函数（urls 版）：`(origin: string, allowlist: string[]) => boolean`
 * - `assertSsoOrigin`（sso 版）：`(requestUrl: string, csv) => string`（失败即抛）
 *
 * 同名不同契约是隐雷：调用方按其中一种签名编写、编译到另一种上，行为完全错位。
 * 现把布尔变体独立命名为 {@link isSsoOriginAllowed}，`assertSsoOrigin`
 * 专指"失败即抛"的严格版本。
 *
 * @returns 是否在列表内；`"*"` 表示放行任意
 */
export function isSsoOriginAllowed(origin: string, allowlist: string[]): boolean {
  if (allowlist.includes("*")) return true;
  const normalized = normalizeOrigin(origin);
  return allowlist.map(normalizeOrigin).includes(normalized);
}

/**
 * 判定请求是否来源于本地开发环境（localhost / 127.0.0.1 / ::1 / *.local / *.localhost）
 *
 * 放在 `urls` 而非 `ui`：这是纯粹的 host 判定，与 UI 无关。
 * 早先它在 `ui/auth-pages.ts`，导致 `basepath` → `ui/auth-pages` →
 * `http` → `basepath` 的运行时循环 —— 只用 basepath 的 Worker
 * 会被拖进整个 UI 层。
 *
 * @param reqOrHost Request 实例或裸 host 字符串
 */
export function isLocalhost(reqOrHost?: Request | string | null): boolean {
  if (!reqOrHost) return false;
  if (typeof reqOrHost === "string") {
    const cleanHost = reqOrHost.trim().toLowerCase().replace(/:\d+$/, "");
    return (
      cleanHost === "localhost" ||
      cleanHost === "127.0.0.1" ||
      cleanHost === "[::1]" ||
      cleanHost === "::1" ||
      cleanHost.endsWith(".localhost") ||
      cleanHost.endsWith(".local")
    );
  }
  if (typeof reqOrHost === "object" && "url" in reqOrHost) {
    try {
      const u = new URL(reqOrHost.url);
      return isLocalhost(u.hostname);
    } catch {
      return false;
    }
  }
  return false;
}
