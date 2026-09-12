/**
 * @nuln/worker-kit/crypto
 *
 * 边缘密码学、安全哈希、AES-GCM 对称加解密、常量时间比对、HMAC 签名与随机数工具
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

function u8(s: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(enc.encode(s));
}

/** ArrayBuffer / Uint8Array 转 Base64URL 字符串（URL-safe，无填充）。 */
export function toB64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Base64URL 字符串反解为 Uint8Array。 */
export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** SHA-256 哈希（返回 Uint8Array）。 */
export async function sha256(data: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return new Uint8Array(hashBuffer);
}

/** SHA-256 哈希（返回 Hex 字符串）。 */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const hashBytes = await sha256(data);
  return Array.from(hashBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 常量时间字符串比对（防时序侧信道攻击）。 */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** 生成指定字节数的密码学安全随机 Token（Base64URL 格式）。 */
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toB64url(buf);
}

/** 生成指定长度的密码学安全随机 Hex 字符串。 */
export function randomHex(length = 32): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

/** 生成指定字节数的 Base64URL 随机字符串。 */
export function randomB64url(byteLength = 32): string {
  return randomToken(byteLength);
}

/** HMAC-SHA256 签名（返回 Hex）。 */
export async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data) as BufferSource);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** HMAC-SHA256 签名（返回 Base64URL）。 */
export async function signHmacSha256(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data) as BufferSource);
  return toB64url(new Uint8Array(sig));
}

/** 校验 HMAC-SHA256 签名。 */
export async function verifyHmacSha256(secret: string, data: string, signature: string): Promise<boolean> {
  const expected = await signHmacSha256(secret, data);
  return safeEqual(expected, signature);
}

/** 从密码派生 AES-GCM-256 密钥 */
export async function deriveKey(passphrase: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    u8(passphrase) as BufferSource,
  );
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * 把任意 JS 对象/数据加密成 "iv.ciphertext" 格式的 base64url 字符串
 * 适用于数据库敏感字段加密存储
 */
export async function encryptJson(obj: unknown, passphrase: string): Promise<string> {
  const ck = await deriveKey(passphrase);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    ck,
    u8(JSON.stringify(obj)) as BufferSource,
  );
  return toB64url(iv) + "." + toB64url(ct);
}

/**
 * 解密由 encryptJson 生成的 base64url 字符串
 */
export async function decryptJson<T>(blob: string, passphrase: string): Promise<T> {
  const ck = await deriveKey(passphrase);
  const [ivB64, ctB64] = blob.split(".");
  if (!ivB64 || !ctB64) throw new Error("bad encrypted blob");
  const iv = fromB64url(ivB64);
  const ct = fromB64url(ctB64);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    ck,
    ct as BufferSource,
  );
  return JSON.parse(dec.decode(new Uint8Array(pt))) as T;
}

/** 加密纯文本字符串 */
export async function encryptSecret(plainText: string, passphrase: string): Promise<string> {
  return encryptJson(plainText, passphrase);
}

/** 解密纯文本字符串 */
export async function decryptSecret(blob: string, passphrase: string): Promise<string> {
  return decryptJson<string>(blob, passphrase);
}

/**
 * 基于 WebCrypto PBKDF2 的密码哈希（跨运行时标准实现）
 * 格式：`pbkdf2:sha256:100000:<saltB64>:<hashB64>`
 */
export async function hashPassword(password: string, iterations = 100_000): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const pwKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password) as BufferSource,
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    pwKey,
    256,
  );
  const saltB64 = toB64url(salt);
  const hashB64 = toB64url(new Uint8Array(derivedBits));
  return `pbkdf2:sha256:${iterations}:${saltB64}:${hashB64}`;
}

/**
 * 校验 PBKDF2 密码哈希
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const parts = storedHash.split(":");
    if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") {
      return false;
    }
    const iterations = parseInt(parts[2], 10);
    const salt = fromB64url(parts[3]);
    const expectedHash = parts[4];

    const pwKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(password) as BufferSource,
      { name: "PBKDF2" },
      false,
      ["deriveBits"],
    );
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256",
      },
      pwKey,
      256,
    );
    const actualHash = toB64url(new Uint8Array(derivedBits));
    return safeEqual(expectedHash, actualHash);
  } catch {
    return false;
  }
}
