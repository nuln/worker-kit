/**
 * @nuln/worker-kit/urls
 *
 * 边缘多域名与 BasePath 动态解析规范库
 * 遵循 MULTI_DOMAIN_DYNAMIC_OIDC_SPEC.md (v1.4)
 */

export interface IssuerEnv {
  AUTH_SERVER_URL?: string;
  ORIGIN?: string;
  RP_ID?: string;
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
  return (
    h === "localhost" ||
    h === "::1" ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)
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
 * 3. 自动放行 RP_ID 自身域、本地回环或 ORIGIN 白名单，拒绝未授权 Host。
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
  const allowedOrigins = parseOriginAllowlist(env.ORIGIN, defaultTrustedOrigin);
  const rpIDs = (env.RP_ID || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const cleanHost = url.hostname.toLowerCase();
  const matchesRpID = rpIDs.some((id) => cleanHost === id || cleanHost.endsWith("." + id));

  const isAllowed =
    allowedOrigins.includes("*") ||
    isLoopbackHostname(url.hostname) ||
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
export function validateRedirectUri(
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
 * 回跳 URL 安全校验：必须同源且落在当前 SP 的 basePath 范围内
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
