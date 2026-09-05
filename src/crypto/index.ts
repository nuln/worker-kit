/**
 * @nuln/worker-kit/crypto
 *
 * 边缘密码学、安全哈希、常量时间比对与随机数工具
 */

/** SHA-256 哈希（返回 Uint8Array）。 */
export async function sha256(data: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(hashBuffer);
}

/** SHA-256 哈希（返回 Hex 字符串）。 */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const hashBytes = await sha256(data);
  return Array.from(hashBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 常量时间字符串比对（防时序攻击）。 */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let c = 0;
  for (let i = 0; i < aBytes.length; i++) {
    c |= aBytes[i] ^ bBytes[i];
  }
  return c === 0;
}

/** 生成指定长度的密码学安全随机 Hex 字符串。 */
export function randomToken(length = 32): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

/** 生成指定字节数的 Base64URL 随机字符串。 */
export function randomB64url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** HMAC-SHA256 签名（返回 Hex）。 */
export async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
