/**
 * @nuln/worker-kit/session
 *
 * RFC 6265bis 标准 Cookie 格式化与会话管理工具
 */

export interface CookieOptions {
  sameSite?: "Lax" | "Strict" | "None";
  maxAge?: number;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
}

/** 构造标准 Cookie 属性字符串。 */
export function cookieAttrs(
  requestOrSecure: Request | boolean,
  options: CookieOptions = {},
): string {
  const isSecure =
    typeof requestOrSecure === "boolean"
      ? requestOrSecure
      : new URL(requestOrSecure.url).protocol === "https:";

  const sameSite = options.sameSite ?? "Lax";
  const maxAge = options.maxAge ?? 28800;
  const path = options.path ?? "/";
  const httpOnly = options.httpOnly ?? true;

  let attrs = `Path=${path}; SameSite=${sameSite}; Max-Age=${maxAge}`;
  if (httpOnly) attrs += "; HttpOnly";
  if (isSecure || options.secure) attrs += "; Secure";
  return attrs;
}

/**
 * 从 Cookie 请求头中解析特定键的值。
 *
 * ## 边界防御
 *
 * - **畸形百分号编码不再抛异常**：`decodeURIComponent` 遇到残缺转义
 *   （如 `sid=%`、`sid=%zz`）会抛 `URIError`。Cookie 头完全由客户端控制，
 *   一个畸形头若穿透到这里，会让所有读取会话的路由抛 500 —— 未认证、远程、
 *   零成本的可用性问题。此处一律按「该键不存在」处理。
 * - **值内含 `=` 不再被截断**：只按**第一个** `=` 切分，保留后续 `=`
 *   （base64 padding 等合法场景）。
 * - 键名去除首尾空白，容忍 `a=1; sid=x` 这类不规范分隔。
 * - **值不做 trim**：RFC 6265 的 cookie-octet 不允许裸空格，且 kit 自身签发时
 *   已 `encodeURIComponent`（空格编码为 `%20`），因此残留空格说明该 Cookie
 *   并非本 kit 签发；静默裁剪会掩盖这类异常，故原样返回。
 *
 * @returns 解析并 URL 解码后的值；键不存在或解码失败时返回 `null`
 */
export function parseCookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k !== name) continue;
    const raw = part.slice(eq + 1);
    if (!raw) return "";
    try {
      return decodeURIComponent(raw);
    } catch {
      // 畸形转义：按不存在处理，绝不抛出
      return null;
    }
  }
  return null;
}

/**
 * 签发 Session Cookie 字符串：
 * 自动遵循 Mode A（__Host- 前缀强制 Path=/）或 Mode B（指定子路径）。
 */
export function formatSessionCookie(
  name: string,
  token: string,
  requestOrSecure: Request | boolean,
  basePath = "",
  maxAge = 28800,
): string {
  const cleanBase = basePath.replace(/\/+$/, "");
  // 若使用 __Host- 前缀，RFC 强制要求 Path=/
  const path = name.startsWith("__Host-") ? "/" : cleanBase || "/";
  const attrs = cookieAttrs(requestOrSecure, { path, maxAge, sameSite: "Lax", httpOnly: true });
  return `${name}=${encodeURIComponent(token)}; ${attrs}`;
}

/**
 * 清除 Session Cookie 字符串（Max-Age=0）。
 */
export function clearSessionCookie(
  name: string,
  requestOrSecure: Request | boolean = true,
  basePath = "",
): string {
  return formatSessionCookie(name, "", requestOrSecure, basePath, 0);
}

export * from "./do.js";


