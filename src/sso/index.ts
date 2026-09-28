/**
 * @nuln/worker-kit/sso
 *
 * OpenID Connect / SSO 支持：Origin 白名单、RP ID 解析、issuer 推导与回调地址归一化。
 *
 * ## 与 `@nuln/worker-kit/urls` 的关系
 *
 * 共享的 URL / Origin 安全原语（`normalizeOrigin`、`assertSsoOrigin`、
 * `resolveIssuer`、`isSafeNextUrl` 等 14 个符号）此前在 `sso` 与 `urls` 中
 * 各有一份**逐字相同**的实现。这会让安全修复只改一处、静默失守另一处
 * （历史上 `fix(sso): reject userinfo in isSafeNextUrl` 即为此类）。
 *
 * 现统一收敛到 `urls/origin.ts`，本模块只保留 OIDC 特有的两个函数：
 * `deriveOidcIssuerFromOrigin`（SP origin → IdP issuer 推导）与
 * `resolveOidcRedirectUri`。
 *
 * 两个模块再导出的是**同一份实现**，因此从 `.../sso` 与 `.../urls` 拿到的是
 * 同一个函数对象，不存在"改了一处另一处仍是旧行为"的可能。
 */

import {
  isLoopbackHostname,
  normalizeOrigin,
  normalizeSubPath,
  parseOriginAllowlist,
  assertSsoOrigin,
  normalizeIssuerUrl,
  normalizeRedirectUri,
} from "../urls/origin.js";

// 共享原语的再导出：保持 `@nuln/worker-kit/sso` 的公开 API 不变
export * from "../urls/origin.js";

/**
 * 根据 SP 的 Origin 智能解析 IdP OIDC 的 Issuer 地址：
 * 1. 本地回环或局域网 (localhost / 127.0.0.1) 且带端口时，OIDC IdP 默认路由在 8787 端口；
 * 2. Cloudflare workers.dev 边缘子域名 (<service>.<tenant>.workers.dev)，自动路由至 oidc.<tenant>.workers.dev；
 * 3. 统一多域名/自定义主域名同构部署 (如 dukangxu.com/tower -> dukangxu.com/oidc)，原样保留 host 并拼接 subpath。
 */
export function deriveOidcIssuerFromOrigin(
  spOrigin: string,
  subPath: string = "/oidc",
): string {
  const normSubPath = normalizeSubPath(subPath || "/oidc");
  const u = new URL(normalizeOrigin(spOrigin));

  if (isLoopbackHostname(u.hostname)) {
    if (u.port && u.port !== "8787") {
      return `${u.protocol}//${u.hostname}:8787${normSubPath}`;
    }
    return `${u.origin}${normSubPath}`;
  }

  const match = u.hostname.match(/^([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+\.workers\.dev)$/i);
  if (match && match[1].toLowerCase() !== "oidc") {
    return `${u.protocol}//oidc.${match[2]}${normSubPath}`;
  }

  return `${u.origin}${normSubPath}`;
}

/**
 * 解析 SP 侧目标 OIDC Issuer：
 * 相对路径（如 "/oidc"）按当前请求 origin 拼接（须先过白名单）；
 * 绝对 URL 直接归一化使用。
 */
export function resolveOidcIssuer(
  issuerConfig: string | undefined,
  requestUrl?: string,
  allowedOriginsCsv?: string,
): string {
  const cleanConfig = (issuerConfig ?? "").trim().replace(/\/+$/, "");
  if (!cleanConfig) {
    throw new Error("OIDC not configured");
  }
  if (cleanConfig.startsWith("/")) {
    if (!requestUrl) throw new Error("request context required for relative OIDC_ISSUER");
    const origin = assertSsoOrigin(requestUrl, allowedOriginsCsv);
    return deriveOidcIssuerFromOrigin(origin, cleanConfig);
  }
  if (/^https?:\/\//i.test(cleanConfig)) return normalizeIssuerUrl(cleanConfig);
  throw new Error(
    "invalid_oidc_issuer_config: must be relative path or absolute http(s) URL",
  );
}

/**
 * 自动派生回调地址 (SP 侧)：
 * 环境覆盖（绝对或相对路径）优先并规范化；缺省为
 * `${origin}${base}/admin/oidc/callback`。
 */
export function resolveOidcRedirectUri(
  envRedirectUri: string | undefined,
  requestUrl: string,
  basePath = "",
  callbackSubpath = "/admin/oidc/callback",
  allowedOriginsCsv?: string,
): string {
  const origin = assertSsoOrigin(requestUrl, allowedOriginsCsv);
  if (envRedirectUri && envRedirectUri.trim()) {
    const raw = envRedirectUri.trim();
    const full = raw.startsWith("/") ? `${origin}${normalizeSubPath(raw)}` : raw;
    return normalizeRedirectUri(full);
  }
  const base = normalizeSubPath(basePath);
  const sub = `/${String(callbackSubpath || "").replace(/^\/+/, "")}`;
  const combined = `${base}${sub}`;
  if (/(^|\/)\.\.(\/|$)/.test(combined)) {
    throw new Error("invalid_callback_subpath: dot segments not allowed");
  }
  return normalizeRedirectUri(`${origin}${combined}`);
}

/**
 * 回跳 URL 安全校验：必须同源且落在当前 SP 的 basePath 范围内
 *（含 exact base 与子路径），根路径部署放行同源任意路径。
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

export * from "./client.js";
