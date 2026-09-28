import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createEmailProvider, toRecipients, getDefaultFromEmail } from "../../src/email/index.js";

describe("[E2E Example] 09 - Multi-Provider Resilient Email Delivery Gateway", () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("orchestrates recipient sanitization, template rendering, and Resend/Webhook dispatch", async () => {
    // 1. Recipient sanitization
    const rawRecipients = "Alice <alice@nuln.net>, bob@nuln.net; charlie@nuln.net";
    const cleaned = toRecipients(rawRecipients);
    expect(cleaned).toEqual(["Alice <alice@nuln.net>", "bob@nuln.net", "charlie@nuln.net"]);

    // 2. Default sender derivation
    const from = getDefaultFromEmail({ DOMAINS: "auth.nuln.net" });
    expect(from).toBe("noreply@auth.nuln.net");

    // 3. Provider factory with Resend API
    const resendProvider = createEmailProvider({
      RESEND_API_KEY: "re_test_live_key",
      EMAIL_FROM: from,
    });

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: "resend_msg_001" }), { status: 200 }));

    await resendProvider.send({
      to: cleaned,
      subject: "Your Nuln Verification Code",
      text: "Your code is 889900",
      html: "<h1>Your code is <strong>889900</strong></h1>",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const resendCall = mockFetch.mock.calls[0];
    expect(resendCall[0]).toBe("https://api.resend.com/emails");
    expect(resendCall[1].headers.Authorization).toBe("Bearer re_test_live_key");

    // 4. Provider factory with Webhook Inbound Gateway
    const webhookProvider = createEmailProvider({
      EMAIL_WEBHOOK_URL: "https://mail.internal.nuln.net/api/send",
      EMAIL_API_KEY: "internal_api_key_xyz",
      EMAIL_FROM: from,
    });

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ queued: true }), { status: 200 }));

    await webhookProvider.send({
      to: "admin@nuln.net",
      subject: "Security Alert",
      text: "New login detected from IP 1.2.3.4",
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const webhookCall = mockFetch.mock.calls[1];
    expect(webhookCall[0]).toBe("https://mail.internal.nuln.net/api/send");
    expect(webhookCall[1].headers.Authorization).toBe("Bearer internal_api_key_xyz");
  });
});
