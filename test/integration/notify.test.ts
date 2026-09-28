import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  assertSafePublicUrl,
  maskSecret,
  maskChannelConfig,
  mergeChannelConfig,
  formatToText,
  formatToMarkdown,
  formatToTelegramHtml,
  formatToWeComMarkdown,
  formatToFeishuCard,
  formatToHtml,
  sendTelegram,
  sendBark,
  sendFeishu,
  sendWeCom,
  sendWebhook,
  sendEmail,
  sendChannelNotification,
  dispatchNotification,
  broadcastNotification,
  testChannelNotification,
} from "../../src/notify/index.js";

describe("@nuln/worker-kit/notify - Comprehensive Test Suite", () => {
  describe("Security & SSRF Protection", () => {
    it("validates valid public HTTPS URLs", () => {
      const url = assertSafePublicUrl("https://api.telegram.org/bot123/send");
      expect(url.hostname).toBe("api.telegram.org");
    });

    it("rejects invalid URL strings", () => {
      expect(() => assertSafePublicUrl("not_a_url")).toThrow("Invalid URL format");
    });

    it("rejects non-http/https protocols", () => {
      expect(() => assertSafePublicUrl("ftp://example.com")).toThrow("Only HTTPS endpoints are permitted");
    });

    it("detects private IPv4 networks (10.x, 172.16-31.x, 192.168.x, 169.254.x)", () => {
      expect(() => assertSafePublicUrl("https://10.0.0.1/webhook")).toThrow("Private/Loopback IP blocked");
      expect(() => assertSafePublicUrl("https://172.20.1.1/webhook")).toThrow("Private/Loopback IP blocked");
      expect(() => assertSafePublicUrl("https://192.168.1.100/webhook")).toThrow("Private/Loopback IP blocked");
      expect(() => assertSafePublicUrl("https://169.254.169.254/latest/meta-data")).toThrow("Private/Loopback IP blocked");
    });

    it("masks secrets and channel configs accurately", () => {
      expect(maskSecret("")).toBe("");
      expect(maskSecret("short")).toBe("********");
      expect(maskSecret("1234567890abcdef")).toBe("1234***cdef");

      const tgMasked = maskChannelConfig("telegram", { botToken: "1234567890:ABCDefgh-12345678", chatId: "998877" });
      expect(tgMasked.botToken).toContain("***");
      expect(tgMasked.chatId).toBe("998877");

      const barkMasked = maskChannelConfig("bark", { deviceKey: "my_very_long_device_key_12345" });
      expect(barkMasked.deviceKey).toContain("***");

      const feishuMasked = maskChannelConfig("feishu", { webhookUrl: "https://open.feishu.cn", secret: "sec_12345678" });
      expect(feishuMasked.secret).toBe("sec_***5678");

      const webhookMasked = maskChannelConfig("webhook", { url: "https://hook.site", secret: "whsec_abcdef1234" });
      expect(webhookMasked.secret).toContain("***");

      expect(maskChannelConfig("email", null as any)).toEqual({});
    });

    it("merges incoming masked configs without overwriting stored credentials", () => {
      const existing = {
        botToken: "original_bot_token_secret",
        chatId: "12345",
      };
      const incoming = {
        botToken: "orig***cret",
        chatId: "67890",
      };
      const merged = mergeChannelConfig(existing, incoming);
      expect(merged.botToken).toBe("original_bot_token_secret");
      expect(merged.chatId).toBe("67890");

      expect(mergeChannelConfig(null, incoming)).toEqual(incoming);
    });
  });

  describe("Message Formatters", () => {
    const payload = {
      title: "Security Alert",
      message: "New login from unknown device",
      level: "alert" as const,
      event: "login",
      details: {
        IP: "1.2.3.4",
        Location: "Tokyo, JP",
      },
      link: "https://nuln.net/security",
      timestamp: 1700000000000,
    };

    it("formats Plain Text", () => {
      const text = formatToText(payload);
      expect(text).toContain("Security Alert");
      expect(text).toContain("IP: 1.2.3.4");
      expect(text).toContain("Link: https://nuln.net/security");
    });

    it("formats Markdown", () => {
      const md = formatToMarkdown(payload);
      expect(md).toContain("### 🚨 Security Alert");
      expect(md).toContain("- **IP**: `1.2.3.4`");
      expect(md).toContain("[🔗 查看详情 / View Details](https://nuln.net/security)");
    });

    it("formats Telegram HTML", () => {
      const tg = formatToTelegramHtml(payload);
      expect(tg).toContain("<b>🚨 Security Alert</b>");
      expect(tg).toContain("<b>IP</b>: <code>1.2.3.4</code>");
      expect(tg).toContain('<a href="https://nuln.net/security">');
    });

    it("formats WeCom Markdown", () => {
      const wecom = formatToWeComMarkdown(payload);
      expect(wecom).toContain('<font color="warning">### Security Alert</font>');
      expect(wecom).toContain("**IP**");
    });

    it("formats Feishu Interactive Card", () => {
      const card = formatToFeishuCard(payload);
      expect(card.msg_type).toBe("interactive");
      expect(card.card.header.title.content).toBe("Security Alert");
      expect(card.card.header.template).toBe("red");
    });

    it("formats Responsive HTML", () => {
      const html = formatToHtml(payload);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Security Alert");
      expect(html).toContain("1.2.3.4");
      expect(html).toContain("href=\"https://nuln.net/security\"");
    });
  });

  describe("Drivers & Engine", () => {
    // 全局 stub fetch：本 describe 内的驱动用例都走真实发送路径。
    // 曾依赖配置值里的 `mock_` 子串命中生产代码的 mock 分支 —— 那种判定本身
    // 就是缺陷（生产 URL/密钥含 "mock" 会静默吞掉通知并回报成功），已移除。
    let originalFetch: typeof globalThis.fetch;
    beforeEach(() => {
      originalFetch = globalThis.fetch;
      // 各通道的成功码不同（Bark code=200，飞书 code=0，企微 errcode=0，
      // Telegram ok=true），因此按 URL 分流返回各自真实格式的响应体 ——
      // 用一个通用 body 会掩盖驱动层的响应校验。
      globalThis.fetch = vi.fn().mockImplementation(async (url: any) => {
        const u = String(url);
        let body: unknown;
        if (u.includes("api.day.app")) {
          body = { code: 200, message: "success", id: "bark-1" };
        } else if (u.includes("feishu.cn")) {
          body = { code: 0, msg: "success" };
        } else if (u.includes("weixin.qq.com")) {
          body = { errcode: 0, errmsg: "ok" };
        } else if (u.includes("api.telegram.org")) {
          body = { ok: true, result: { message_id: 12345 } };
        } else {
          body = { ok: true };
        }
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;
    });
    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    const payload = {
      title: "Test Login",
      message: "A test notification message",
      level: "info" as const,
      event: "login",
    };

    // 以下用例统一 stub fetch 走**真实发送路径**。
    // 曾依赖 `mock_` 子串命中生产代码里的 mock 分支 —— 那种判定本身是缺陷
    // （生产 URL 里出现 "mock" 就会静默吞掉通知并回报成功），已移除。
    it("handles Telegram driver validation & send", async () => {
      const errRes = await sendTelegram({ botToken: "", chatId: "" }, payload);
      expect(errRes.ok).toBe(false);

      const okRes = await sendTelegram({ botToken: "tg_token_value", chatId: "12345" }, payload);
      expect(okRes.ok).toBe(true);
    });

    it("handles Bark driver validation & send", async () => {
      const errRes = await sendBark({ deviceKey: "" }, payload);
      expect(errRes.ok).toBe(false);

      const okRes = await sendBark({ deviceKey: "bark_key_value" }, payload);
      expect(okRes.ok).toBe(true);
    });

    it("handles Feishu driver validation & send", async () => {
      const errRes = await sendFeishu({ webhookUrl: "" }, payload);
      expect(errRes.ok).toBe(false);

      const okRes = await sendFeishu(
          { webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/tok_abcdef123456", secret: "sec123" },
          payload,
        );
      expect(okRes.ok).toBe(true);
    });

    it("handles WeCom driver validation & send", async () => {
      const errRes = await sendWeCom({ webhookUrl: "" }, payload);
      expect(errRes.ok).toBe(false);

      const okRes = await sendWeCom(
          { webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=wecom_key_123" },
          payload,
        );
      expect(okRes.ok).toBe(true);
    });

    it("handles Webhook driver validation & send with HMAC", async () => {
      const errRes = await sendWebhook({ url: "" }, payload);
      expect(errRes.ok).toBe(false);

      const okRes = await sendWebhook(
          { url: "https://example.com/hooks/incoming", secret: "whsec_secret" },
          payload,
        );
      expect(okRes.ok).toBe(true);
    });

    it("生产 URL 含 mock 字样时不再被静默吞掉（回归）", async () => {
      // 曾用 `url.includes("mock")` 判定测试环境：这类生产 URL 会命中，
      // 只打日志后返回 { ok: true }，告警静默丢失而调用方收到"成功"。
      const calls: number[] = [];
      const original = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        calls.push(1);
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch;
      try {
        const res = await sendWebhook(
          { url: "https://api.example.com/mock/v1/send", secret: "s" },
          payload,
        );
        expect(calls.length, "含 mock 的 URL 必须真正发起请求").toBe(1);
        expect(res.ok).toBe(true);
      } finally {
        globalThis.fetch = original;
      }
    });

    it("handles Email driver send via mock provider", async () => {
      const errRes = await sendEmail({ to: "" }, payload);
      expect(errRes.ok).toBe(false);

      const okRes = await sendEmail(
        { to: "user@example.com" },
        payload,
        { EMAIL_PROVIDER: "console" }
      );
      expect(okRes.ok).toBe(true);
    });

    it("dispatches notification with fail-safe error isolation", async () => {
      const res = await dispatchNotification({
        channel: "telegram",
        config: { botToken: "tg_token_value", chatId: "123" },
        payload,
      });
      expect(res.ok).toBe(true);

      const unknownRes = await dispatchNotification({
        channel: "invalid" as any,
        config: {},
        payload,
      });
      expect(unknownRes.ok).toBe(false);
    });

    it("supports ctx.waitUntil non-blocking dispatch", async () => {
      const tasks: Promise<any>[] = [];
      const ctx = {
        waitUntil: (p: Promise<any>) => {
          tasks.push(p);
        },
      };

      const res = await dispatchNotification({
        channel: "bark",
        config: { deviceKey: "bark_key_value" },
        payload,
        ctx,
      });
      expect(res.ok).toBe(true);
      expect(tasks.length).toBe(1);
      await Promise.all(tasks);
    });

    it("broadcasts notifications to multiple channels with event filtering", async () => {
      const channels = [
        {
          channel: "telegram" as const,
          config: { botToken: "tg_token_value", chatId: "123" },
          enabled: true,
          events: { login: true, bind: false },
        },
        {
          channel: "bark" as const,
          config: { deviceKey: "bark_key_value" },
          enabled: false,
          events: { login: true },
        },
        {
          channel: "webhook" as const,
          config: { url: "https://api.example.com/hooks/incoming" },
          enabled: true,
          events: { login: true, bind: true },
        },
      ];

      // 1) Broadcast login event -> telegram and webhook should receive, bark is disabled
      const loginResults = await broadcastNotification(channels, payload, { event: "login" });
      expect(loginResults.length).toBe(2);
      expect(loginResults.map((r) => r.channel)).toEqual(["telegram", "webhook"]);

      // 2) Broadcast bind event -> only webhook should receive
      const bindResults = await broadcastNotification(channels, payload, { event: "bind" });
      expect(bindResults.length).toBe(1);
      expect(bindResults[0].channel).toBe("webhook");

      // 3) Broadcast with none matching
      const noneResults = await broadcastNotification([], payload);
      expect(noneResults).toEqual([]);
    });

    it("sends test notification in zh-CN and en-US", async () => {
      const zhRes = await testChannelNotification("telegram", { botToken: "tg_token_value", chatId: "123" }, {}, "zh-CN");
      expect(zhRes.ok).toBe(true);

      const enRes = await testChannelNotification("bark", { deviceKey: "bark_key_value" }, {}, "en-US");
      expect(enRes.ok).toBe(true);
    });
  });
});
