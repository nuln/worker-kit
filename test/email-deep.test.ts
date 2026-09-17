import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  toRecipients,
  getDefaultFromEmail,
  ConsoleEmailProvider,
  ResendEmailProvider,
  HttpEmailProvider,
  createEmailProvider,
  isEmailConfigured,
} from "../src/email/index.js";

describe("@nuln/worker-kit/email - Deep Coverage", () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("toRecipients parses arrays, comma/semicolon/space separated addresses and names", () => {
    expect(toRecipients(null)).toEqual([]);
    expect(toRecipients(undefined)).toEqual([]);
    expect(toRecipients("")).toEqual([]);
    expect(toRecipients("alice@test.com, bob@test.com; charlie@test.com")).toEqual([
      "alice@test.com",
      "bob@test.com",
      "charlie@test.com",
    ]);
    expect(toRecipients(["Admin <admin@test.com>", "user1@test.com user2@test.com"])).toEqual([
      "Admin <admin@test.com>",
      "user1@test.com",
      "user2@test.com",
    ]);
    // Deduplication
    expect(toRecipients(["a@b.com", "a@b.com", "b@c.com"])).toEqual(["a@b.com", "b@c.com"]);
  });

  it("getDefaultFromEmail adapts from domain host or env variables", () => {
    expect(getDefaultFromEmail({}, "api.nuln.net")).toBe("noreply@api.nuln.net");
    expect(getDefaultFromEmail({ EMAIL_FROM: "support@nuln.net" })).toBe("support@nuln.net");
    expect(getDefaultFromEmail({ DOMAINS: "auth.nuln.net, mail.nuln.net" })).toBe("noreply@auth.nuln.net");
    expect(getDefaultFromEmail({ SEED_DOMAIN: "tower.nuln.net" })).toBe("noreply@tower.nuln.net");
    expect(getDefaultFromEmail({})).toBe("noreply@localhost");
  });

  it("ResendEmailProvider sends HTTP request and throws on non-ok status", async () => {
    const provider = new ResendEmailProvider("re_12345678", "sender@nuln.net");

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: "msg_123" }), { status: 200 }));
    await provider.send({
      to: "receiver@nuln.net",
      subject: "Test Subject",
      text: "Hello",
      html: "<p>Hello</p>",
      headers: { "X-Custom": "val" },
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0];
    expect(call[0]).toBe("https://api.resend.com/emails");
    expect(call[1].headers.Authorization).toBe("Bearer re_12345678");

    // Failure case
    mockFetch.mockResolvedValueOnce(new Response("API rate limit", { status: 429 }));
    await expect(
      provider.send({ to: "receiver@nuln.net", subject: "S", text: "T" })
    ).rejects.toThrow("Resend email delivery failed: 429");
  });

  it("HttpEmailProvider sends POST webhook and throws on error", async () => {
    const provider = new HttpEmailProvider("https://mail.webhook/send", "noreply@nuln.net", "api_key_xyz");

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    await provider.send({
      to: ["r1@test.com", "r2@test.com"],
      subject: "Broadcast",
      text: "Message",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0];
    expect(call[0]).toBe("https://mail.webhook/send");
    expect(call[1].headers.Authorization).toBe("Bearer api_key_xyz");

    // Failure case
    mockFetch.mockResolvedValueOnce(new Response("Webhook 500", { status: 500 }));
    await expect(
      provider.send({ to: "r1@test.com", subject: "S", text: "T" })
    ).rejects.toThrow("email webhook failed: 500");
  });

  it("createEmailProvider selects appropriate provider based on env", () => {
    const httpP = createEmailProvider({
      EMAIL_WEBHOOK_URL: "https://mail.gateway/inbound",
      EMAIL_API_KEY: "secret",
    });
    expect(httpP).toBeInstanceOf(HttpEmailProvider);

    const resendP = createEmailProvider({
      RESEND_API_KEY: "re_real_key",
    });
    expect(resendP).toBeInstanceOf(ResendEmailProvider);

    const consoleP = createEmailProvider({
      EMAIL_PROVIDER: "console",
    });
    expect(consoleP).toBeInstanceOf(ConsoleEmailProvider);

    const fallbackP = createEmailProvider({
      EMAIL_PROVIDER: "unknown_service",
    });
    expect(fallbackP).toBeInstanceOf(ConsoleEmailProvider);
  });

  it("isEmailConfigured validates configuration accurately", () => {
    expect(isEmailConfigured(null)).toBe(true); // in test environment
    expect(isEmailConfigured({ EMAIL_PROVIDER: "console" })).toBe(true);
    expect(isEmailConfigured({ EMAIL_CONFIGURED: "false" })).toBe(false);
    expect(isEmailConfigured({ EMAIL_CONFIGURED: false })).toBe(false);
    expect(isEmailConfigured({ EMAIL_WEBHOOK_URL: "https://mail.nuln.net" })).toBe(true);
    expect(isEmailConfigured({ RESEND_API_KEY: "re_123" })).toBe(true);
    expect(isEmailConfigured({ EMAIL_WEBHOOK_URL: "REPLACE_WITH_URL" })).toBe(true); // test env fallback
  });
});
