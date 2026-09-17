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

/** 从 Cookie 请求头中解析特定键的值。 */
export function parseCookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [k, v] = part.trim().split("=");
    if (k === name) return v ? decodeURIComponent(v) : "";
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


