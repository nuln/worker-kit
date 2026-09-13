import { describe, it, expect, vi } from "vitest";
import {
  generateMagicLinkToken,
  generateOtpCode,
  buildMagicLinkEmailContent,
  buildOtpEmailContent,
  buildEmailVerificationContent,
  genSecret,
  genCode,
  verifyCode,
  otpauthUri,
} from "../src/auth/index.js";
import { RateLimiterDO, RateLimitService } from "../src/ratelimit/index.js";
import { OidcClient } from "../src/sso/client.js";
import {
  resolveOidcIssuer,
  assertSsoOrigin,
  normalizeOrigin,
  normalizeIssuerUrl,
  isSafeNextUrl,
  normalizeRedirectUri,
  validateRedirectUri,
  selectRpId,
} from "../src/urls/index.js";

describe("Auth TOTP & Magic Link Coverage", () => {
  it("generates tokens, OTP codes, and builds email contents", () => {
    const token = generateMagicLinkToken(16);
    expect(token.length).toBeGreaterThan(10);

    const otp = generateOtpCode(6);
    expect(otp.length).toBe(6);

    const ml = buildMagicLinkEmailContent({ link: "https://login.local" });
    expect(ml.subject).toContain("登录链接");
    expect(ml.html).toContain("https://login.local");

    const otpEmail = buildOtpEmailContent({ code: "123456" });
    expect(otpEmail.subject).toContain("123456");

    const verifyEmail = buildEmailVerificationContent({ link: "https://verify.local" });
    expect(verifyEmail.subject).toContain("验证你的 Nuln 邮箱");
  });

  it("TOTP secret generation, code calculation, and verification window", async () => {
    const secret = genSecret(20);
    expect(secret.length).toBe(20);

    const code = await genCode(secret);
    expect(code.length).toBe(6);

    const isValid = await verifyCode(secret, code);
    expect(isValid).toBe(true);

    const isBad = await verifyCode(secret, "000000");
    if (code !== "000000") expect(isBad).toBe(false);

    const uri = otpauthUri(secret, "user@test.local", "TestApp");
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain(secret);
  });
});

describe("RateLimiterDO & RateLimitService Full Branch Coverage", () => {
  it("RateLimiterDO consume, alarm, and fetch", async () => {
    const doLimiter = new RateLimiterDO({}, {});
    const r1 = await doLimiter.consume("user_1", 2, 60);
    expect(r1.ok).toBe(true);
    expect(r1.remaining).toBe(1);

    const r2 = await doLimiter.consume("user_1", 2, 60);
    expect(r2.ok).toBe(true);
    expect(r2.remaining).toBe(0);

    const r3 = await doLimiter.consume("user_1", 2, 60);
    expect(r3.ok).toBe(false);
    expect(r3.retryAfter).toBeGreaterThan(0);

    await doLimiter.alarm();

    const postReq = new Request("https://rl.local/consume", {
      method: "POST",
      body: JSON.stringify({ key: "user_fetch", limit: 5, windowSec: 60 }),
    });
    const res = await doLimiter.fetch(postReq);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);

    const notFound = await doLimiter.fetch(new Request("https://rl.local/other"));
    expect(notFound.status).toBe(404);
  });

  it("RateLimitService handles DO stub direct RPC, DO fetch, DO fallback, and D1", async () => {
    const mockDoRpc = {
      idFromName: vi.fn().mockReturnValue("id_1"),
      get: vi.fn().mockReturnValue({
        consume: vi.fn().mockResolvedValue({ ok: true, remaining: 9 }),
      }),
    };
    const svc1 = new RateLimitService(null, mockDoRpc);
    const res1 = await svc1.consume("key_rpc", 10, 60);
    expect(res1.ok).toBe(true);

    const mockDoFetch = {
      idFromName: vi.fn().mockReturnValue("id_2"),
      get: vi.fn().mockReturnValue({
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, remaining: 8 }), { status: 200 })),
      }),
    };
    const svc2 = new RateLimitService(null, mockDoFetch);
    const res2 = await svc2.consume("key_fetch", 10, 60);
    expect(res2.ok).toBe(true);

    const mockD1 = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(1),
        }),
      }),
    };
    const mockDoFail = {
      idFromName: vi.fn().mockImplementation(() => {
        throw new Error("DO failure");
      }),
    };
    const svc3 = new RateLimitService(mockD1, mockDoFail);
    const res3 = await svc3.consume("key_d1", 5, 60);
    expect(res3.ok).toBe(true);

    const mockD1Over = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(10),
        }),
      }),
    };
    const svc4 = new RateLimitService(mockD1Over);
    const res4 = await svc4.consume("key_over", 5, 60);
    expect(res4.ok).toBe(false);
    expect(res4.remaining).toBe(0);

    const svc5 = new RateLimitService(null);
    const res5 = await svc5.consume("key_none", 5, 60);
    expect(res5.ok).toBe(true);
  });
});

describe("URL Utilities and SSO Url Resolution", () => {
  it("resolves and normalizes OIDC and SSO urls", () => {
    expect(normalizeOrigin("https://APP.EXAMPLE.COM:443/test")).toBe("https://app.example.com");
    expect(normalizeIssuerUrl("https://IDP.EXAMPLE.COM/oidc/")).toBe("https://idp.example.com/oidc");
    expect(isSafeNextUrl("/dashboard", "https://example.com", "")).toBe(true);
    expect(isSafeNextUrl("https://evil.com", "https://example.com", "")).toBe(false);

    expect(normalizeRedirectUri("https://app.com/cb")).toBe("https://app.com/cb");
    expect(selectRpId("app.example.com", ["example.com"])).toBe("example.com");
    expect(validateRedirectUri(JSON.stringify(["https://app.com/cb"]), "https://app.com/cb")).toBe(true);
  });
});
