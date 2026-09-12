import { describe, it, expect } from "vitest";
import {
  toRecipients,
  getDefaultFromEmail,
  createEmailProvider,
  isEmailConfigured,
  ConsoleEmailProvider,
  ResendEmailProvider,
  HttpEmailProvider,
} from "../src/email/index.js";

describe("@nuln/worker-kit/email", () => {
  it("toRecipients: 混合格式解析与去重", () => {
    expect(toRecipients("alice@test.com, bob@test.com")).toEqual([
      "alice@test.com",
      "bob@test.com",
    ]);
    expect(
      toRecipients(["Alice <alice@test.com>", "bob@test.com", "alice@test.com"]),
    ).toEqual(["Alice <alice@test.com>", "bob@test.com", "alice@test.com"]);
  });

  it("getDefaultFromEmail: 域名发件人自适应", () => {
    expect(getDefaultFromEmail({}, "example.com")).toBe("noreply@example.com");
    expect(getDefaultFromEmail({ DOMAINS: "auth.nuln.dev, api.nuln.dev" })).toBe(
      "noreply@auth.nuln.dev",
    );
    expect(getDefaultFromEmail({ EMAIL_FROM: "admin@nuln.dev" })).toBe("admin@nuln.dev");
  });

  it("createEmailProvider: 工厂选型", () => {
    const p1 = createEmailProvider({ EMAIL_WEBHOOK_URL: "https://mail.internal/send" });
    expect(p1).toBeInstanceOf(HttpEmailProvider);

    const p2 = createEmailProvider({ RESEND_API_KEY: "re_123456" });
    expect(p2).toBeInstanceOf(ResendEmailProvider);

    const p3 = createEmailProvider({ MOCK_EXTERNAL_API: "true" });
    expect(p3).toBeInstanceOf(ConsoleEmailProvider);
  });

  it("isEmailConfigured: 状态检测", () => {
    expect(isEmailConfigured({ RESEND_API_KEY: "re_123" })).toBe(true);
    expect(isEmailConfigured({ EMAIL_WEBHOOK_URL: "https://internal/webhook" })).toBe(true);
    expect(isEmailConfigured({ EMAIL_CONFIGURED: "false" })).toBe(false);
  });
});
