/**
 * @nuln/worker-kit/auth
 *
 * 无密码邮件登录 (Magic Link) 与 OTP 验证码组件
 */

import { randomToken, randomHex } from "../crypto/index.js";

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
