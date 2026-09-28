/**
 * @nuln/worker-kit/auth
 *
 * 无密码邮件登录 (Magic Link) 与 OTP 验证码组件
 */

import { randomToken, randomHex, safeEqual } from "../crypto/index.js";

export interface MagicLinkOptions {
  brandName?: string;
  link: string;
  expireMinutes?: number;
}

export interface OtpEmailOptions {
  brandName?: string;
  code: string;
  expireMinutes?: number;
}

export interface VerificationEmailOptions {
  brandName?: string;
  link: string;
  expireHours?: number;
}

/** 生成一次性安全登录 Token */
export function generateMagicLinkToken(bytes = 32): string {
  return randomToken(bytes);
}

/** 生成 N 位数字 OTP 验证码（默认 6 位） */
export function generateOtpCode(digits = 6): string {
  const min = Math.pow(10, digits - 1);
  const max = Math.pow(10, digits) - 1;
  const num = Math.floor(min + Math.random() * (max - min + 1));
  return String(num);
}

/** 构造 Magic Link 登录邮件内容 */
export function buildMagicLinkEmailContent(opts: MagicLinkOptions) {
  const brand = opts.brandName || "Nuln";
  const expire = opts.expireMinutes || 15;
  const link = opts.link;

  return {
    subject: `你的 ${brand} 登录链接`,
    text: `点击或复制以下链接登录你的账号（${expire} 分钟内有效）：\n${link}\n\n如果这不是你本人操作，请忽略本邮件。`,
    html: `<p>点击下方按钮登录你的账号（${expire} 分钟内有效）：</p><p><a href="${link}" style="display:inline-block;padding:8px 16px;background:#181b20;color:#fff;border-radius:6px;text-decoration:none">登录我的账号</a></p><p style="color:#6b7280;font-size:12px">如果按钮无法点击，请复制链接在浏览器打开：<br>${link}</p>`,
  };
}

/** 构造 6 位数字 OTP 验证邮件内容 */
export function buildOtpEmailContent(opts: OtpEmailOptions) {
  const brand = opts.brandName || "Nuln";
  const expire = opts.expireMinutes || 10;
  const code = opts.code;

  return {
    subject: `【${brand}】你的动态验证码为 ${code}`,
    text: `你的动态安全验证码为：${code}（${expire} 分钟内有效）。\n\n请勿将验证码泄露给他人。如果这不是你本人操作，请忽略本邮件。`,
    html: `<p>你正在进行安全验证，动态验证码如下（${expire} 分钟内有效）：</p><div style="font-size:24px;font-weight:bold;letter-spacing:4px;padding:12px;background:#f3f4f6;color:#111;display:inline-block;border-radius:6px">${code}</div><p style="color:#6b7280;font-size:12px;margin-top:16px">请勿将验证码透露给任何人。</p>`,
  };
}

/** 构造邮箱验证激活邮件内容 */
export function buildEmailVerificationContent(opts: VerificationEmailOptions) {
  const brand = opts.brandName || "Nuln";
  const expire = opts.expireHours || 24;
  const link = opts.link;

  return {
    subject: `请验证你的 ${brand} 邮箱`,
    text: `点击或复制以下链接验证你的邮箱（${expire} 小时内有效）：\n${link}\n\n如果这不是你本人操作，请忽略本邮件。`,
    html: `<p>点击下方按钮验证你的邮箱（${expire} 小时内有效）：</p><p><a href="${link}" style="display:inline-block;padding:8px 16px;background:#181b20;color:#fff;border-radius:6px;text-decoration:none">验证邮箱</a></p><p style="color:#6b7280;font-size:12px">如果按钮无法点击，请复制链接在浏览器打开：<br>${link}</p>`,
  };
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 生成 Base32 编码的 TOTP 密钥 */
export function genSecret(len = 20): string {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return Array.from(b, (v) => BASE32[v % 32]).join('');
}

function base32Decode(s: string): Uint8Array {
  const cleaned = s.replace(/[^A-Za-z2-7]/g, '').toUpperCase();
  const bytes: number[] = [];
  let bits = 0,
    val = 0;
  for (const c of cleaned) {
    val = (val << 5) | BASE32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bytes.push((val >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

function decBytes(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    b[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return b;
}

async function hmacSha1(k: Uint8Array, d: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    k as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, d as BufferSource));
}

function truncate(h: Uint8Array): number {
  const o = (h[h.length - 1] ?? 0) & 0xf;
  return (
    (((h[o]! & 0x7f) << 24) |
      ((h[o + 1]! & 0xff) << 16) |
      ((h[o + 2]! & 0xff) << 8) |
      (h[o + 3]! & 0xff)) %
    1000000
  );
}

/** 基于 RFC 6238 生成 6 位 TOTP 动态验证码 */
export async function genCode(
  secret: string,
  ts = Date.now(),
  step = 30,
): Promise<string> {
  const key = base32Decode(secret);
  const hmac = await hmacSha1(
    key,
    decBytes(BigInt(Math.floor(ts / 1000 / step))),
  );
  return String(truncate(hmac)).padStart(6, '0');
}

/** 校验 TOTP 验证码（支持滑动时间窗口与常量时间比对） */
export async function verifyCode(
  secret: string,
  code: string,
  window = 1,
  step = 30,
): Promise<boolean> {
  const now = Date.now();
  for (let i = -window; i <= window; i++) {
    const candidate = await genCode(secret, now + i * step * 1000, step);
    if (safeEqual(candidate, code)) return true;
  }
  return false;
}

/** 构造标准 otpauth:// URI 供 Authenticator App 扫描绑定 */
export function otpauthUri(
  secret: string,
  email: string,
  issuer = 'mail-lite',
): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export * from "./passkey.js";

