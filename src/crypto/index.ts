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

/**
 * SHA-256 哈希（返回小写 Hex 字符串）。
 *
 * 接受 `ArrayBuffer`/`ArrayBufferView` 是为覆盖 S3 SigV4 的 payload 哈希场景
 * （此前 `s3/sigv4.ts` 另有一份同名实现，根 barrel 平铺导出时冲突）。
 * 现以本实现为唯一来源，`s3/sigv4.ts` 再导出之。
 */
export async function sha256Hex(
  data: string | Uint8Array | ArrayBuffer = "",
): Promise<string> {
  const bytes: BufferSource =
    typeof data === "string" ? (u8(data) as BufferSource) : (data as BufferSource);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
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

export const timingSafeEqual = safeEqual;

/** 生成指定字节数的密码学安全随机 Token（Base64URL 格式）。 */
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toB64url(buf);
}

export const randomState = randomToken;
export const generateId = (prefix?: string) => (prefix ? `${prefix}_${randomHex(16)}` : randomHex(16));

/** 生成指定长度的密码学安全随机 Hex 字符串。 */
export function randomHex(length = 32): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

/** 生成带语义前缀的安全随机 API Key / Token（如 `push_live_...`） */
export function generatePrefixedKey(prefix: string, bytes = 24): string {
  const cleanPrefix = prefix.replace(/_+$/, "");
  const token = randomToken(bytes);
  return `${cleanPrefix}_${token}`;
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

/**
 * 密钥派生迭代次数（PBKDF2-HMAC-SHA256）。
 *
 * OWASP 对 PBKDF2-HMAC-SHA256 的当前建议为 600,000。实测 100k 约 8ms、
 * 600k 约 50ms，作为每条记录的存储加密成本可接受。
 */
export const KDF_ITERATIONS = 600_000;

/** 密文格式版本前缀。`v2` = PBKDF2 加盐派生；无前缀 = 遗留 `iv.ct`（单轮 SHA-256）。 */
const CIPHER_V2_PREFIX = "v2";

/**
 * 从口令派生 AES-GCM-256 密钥（PBKDF2-HMAC-SHA256 + 16 字节随机盐）。
 *
 * ## 为什么不直接用 SHA-256
 *
 * 历史实现是 `SHA-256(passphrase)`，即**单轮、无盐、确定性**：
 * - 工作因子为 1，任何口令字典或预计算彩虹表都可瞬间命中
 * - 无盐意味着恢复出一个口令即可解密**历史上所有**用它加密过的数据
 *   （没有每记录盐来抬高多目标攻击的成本）
 * - 派生结果在所有节点上相同，缺少域分离
 *
 * 对 `ENCRYPTION_KEY` / `COOKIE_SECRET` 这类高熵随机值风险较低，但对人可选
 * 口令而言等同明文 —— 而本函数的文档定位正是「数据库敏感字段加密存储」。
 *
 * @param passphrase 口令
 * @param salt 16 字节盐；由调用方生成并随密文一同存储。省略时退化为全零盐，
 *   仅供旧调用方过渡，正式密文一律由 {@link encryptJson} 自行生成随机盐
 * @param iterations 迭代次数，默认 {@link KDF_ITERATIONS}
 * @returns 不可导出的 AES-GCM-256 密钥（`extractable: false`）
 */
export async function deriveKey(
  passphrase: string,
  salt?: Uint8Array,
  iterations: number = KDF_ITERATIONS,
): Promise<CryptoKey> {
  const useSalt = salt ?? new Uint8Array(16);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    u8(passphrase) as BufferSource,
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: useSalt as BufferSource, iterations, hash: "SHA-256" },
    baseKey,
    256,
  );
  return crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * 遗留 KDF：单轮无盐 SHA-256。
 *
 * **仅用于解密历史密文，不得用于新加密**（工作因子为 1 且无盐）。
 */
async function deriveLegacyKey(passphrase: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", u8(passphrase) as BufferSource);
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * 把任意 JS 对象/数据加密成 `"v2.<salt>.<iv>.<ciphertext>"` 格式的 base64url 字符串。
 *
 * 每条记录使用独立的 16 字节盐与 12 字节 IV，适用于数据库敏感字段加密存储。
 *
 * @param obj 待加密数据
 * @param passphrase 口令
 * @returns 带 `v2.` 版本前缀的密文串
 */
export async function encryptJson(obj: unknown, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ck = await deriveKey(passphrase, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    ck,
    u8(JSON.stringify(obj)) as BufferSource,
  );
  return CIPHER_V2_PREFIX + "." + toB64url(salt) + "." + toB64url(iv) + "." + toB64url(ct);
}

/**
 * 解密由 {@link encryptJson} 生成的 base64url 字符串。
 *
 * ## 向后兼容
 *
 * 同时支持两种格式，保证存量数据可读：
 * - `v2.<salt>.<iv>.<ct>`：PBKDF2 加盐派生（当前写入格式）
 * - `<iv>.<ct>`：遗留单轮 SHA-256 派生 —— **仅解密用**
 *
 * 遗留格式的派生强度弱于 `v2`；调用方应在迁移窗口内重写存量数据。
 *
 * @throws 段数既非 2 也非 4、版本前缀不匹配、或 GCM 认证失败
 *   （口令错误 / 数据被篡改）。**不会**静默忽略尾随段。
 */
export async function decryptJson<T>(blob: string, passphrase: string): Promise<T> {
  const parts = blob.split(".");

  if (parts.length === 4 && parts[0] === CIPHER_V2_PREFIX) {
    const [, saltB64, ivB64, ctB64] = parts;
    if (!saltB64 || !ivB64 || !ctB64) throw new Error("bad encrypted blob");
    const ck = await deriveKey(passphrase, fromB64url(saltB64));
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64url(ivB64) as BufferSource },
      ck,
      fromB64url(ctB64) as BufferSource,
    );
    return JSON.parse(dec.decode(new Uint8Array(pt))) as T;
  }

  // 遗留格式：单轮 SHA-256 派生（仅解密）
  if (parts.length === 2) {
    const [ivB64, ctB64] = parts;
    if (!ivB64 || !ctB64) throw new Error("bad encrypted blob");
    const ck = await deriveLegacyKey(passphrase);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64url(ivB64) as BufferSource },
      ck,
      fromB64url(ctB64) as BufferSource,
    );
    return JSON.parse(dec.decode(new Uint8Array(pt))) as T;
  }

  throw new Error("bad encrypted blob");
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

/** PBKDF2 迭代次数下限：低于此值的哈希工作因子为 1，可被瞬间爆破。 */
export const PBKDF2_MIN_ITERATIONS = 100_000;
/**
 * PBKDF2 迭代次数上限（1,000,000）。
 *
 * 上限用于阻断 CPU 耗尽：工作因子来自存储的哈希串，若无上界，一个被污染的
 * 哈希列（`iterations=1e8` 实测单次校验 8.25 秒）会让每次登录/重置都变成
 * 长时间 CPU 燃烧。在 D1 跨节点 LWW 同步场景下这类污染可被远端持久化。
 */
export const PBKDF2_MAX_ITERATIONS = 1_000_000;

/**
 * 校验 PBKDF2 密码哈希
 *
 * ## 边界防御
 *
 * 工作因子（`iterations`）来自**存储的哈希串**，属于不可信输入，因此必须夹紧：
 * - 低于 {@link PBKDF2_MIN_ITERATIONS}：拒绝（单轮哈希等于无保护）
 * - 高于 {@link PBKDF2_MAX_ITERATIONS}：拒绝（阻断 CPU 耗尽）
 *
 * 任何解析/派生异常都返回 `false`（fail-closed），不会绕过校验。
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const parts = storedHash.split(":");
    if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") {
      return false;
    }
    const iterations = Number.parseInt(parts[2], 10);
    // Number.isInteger 同时排除 NaN / Infinity / 小数
    if (
      !Number.isInteger(iterations) ||
      iterations < PBKDF2_MIN_ITERATIONS ||
      iterations > PBKDF2_MAX_ITERATIONS
    ) {
      return false;
    }
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
