import { describe, it, expect } from "vitest";
import {
  generateMagicLinkToken,
  generateOtpCode,
  buildMagicLinkEmailContent,
  buildOtpEmailContent,
  buildEmailVerificationContent,
} from "../src/auth/index.js";

describe("@nuln/worker-kit/auth", () => {
  it("generateMagicLinkToken & generateOtpCode", () => {
    const token = generateMagicLinkToken(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);

    const otp = generateOtpCode(6);
    expect(otp).toMatch(/^\d{6}$/);
  });

  it("buildMagicLinkEmailContent: 模板生成", () => {
    const content = buildMagicLinkEmailContent({
      brandName: "OIDC",
      link: "https://auth.nuln.dev/verify?token=123",
      expireMinutes: 15,
    });
    expect(content.subject).toContain("OIDC");
    expect(content.text).toContain("https://auth.nuln.dev/verify?token=123");
    expect(content.html).toContain("登录我的账号");
  });

  it("buildOtpEmailContent & buildEmailVerificationContent", () => {
    const otp = buildOtpEmailContent({ code: "123456", brandName: "Console" });
    expect(otp.subject).toContain("123456");
    expect(otp.html).toContain("123456");

    const v = buildEmailVerificationContent({ brandName: "Mail", link: "https://mail.nuln.dev/verify" });
    expect(v.subject).toContain("验证你的 Mail 邮箱");
  });
});
