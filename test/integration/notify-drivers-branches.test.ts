/**
 * 通知驱动（notify drivers）分支覆盖
 *
 * ## 为什么要专门补这一组
 *
 * 覆盖率报告长期显示这三个驱动是全库最低：
 * - `wecom.ts`  65% stmts / 33% funcs
 * - `bark.ts`   64% stmts / 50% funcs
 * - `feishu.ts` 77% stmts / 50% funcs
 *
 * 原因是它们此前**完全没有独立测试**（只在综合套件里被间接带过），而这三个
 * 通道正是运维告警的实际投递路径。75% 的语句覆盖意味着「响应体缺字段时被
 * 误判为成功」这类分支从未被验证过 —— 而那恰好是告警静默丢失的路径。
 *
 * 下面每条用例都锁定一个具体分支，不为了数字而写。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendWeCom, sendBark, sendFeishu } from "../../src/notify/index.js";
import { maskChannelConfig, mergeChannelConfig } from "../../src/notify/security.js";

const payload = {
  title: "Security Alert",
  message: "New login from 1.2.3.4",
  level: "info" as const,
  event: "login",
};

let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(impl: (url: string, init: any) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn().mockImplementation((url: any, init: any) =>
    Promise.resolve(impl(String(url), init)),
  ) as unknown as typeof fetch;
}

const WECOM_URL = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=wecom_key_abc";
const FEISHU_URL = "https://open.feishu.cn/open-apis/bot/v2/hook/feishu_token_abc";
const BARK_URL = "https://api.day.app/bark_key_abc";

describe("WeCom 驱动", () => {
  it("缺少 webhookUrl 时返回失败而非静默成功", async () => {
    const res = await sendWeCom({ webhookUrl: "" }, payload);
    expect(res.ok).toBe(false);
  });

  it("拒绝内网地址（SSRF 防护）", async () => {
    const res = await sendWeCom({ webhookUrl: "https://127.0.0.1/hook" }, payload);
    expect(res.ok).toBe(false);
  });

  it("成功时返回 ok", async () => {
    stubFetch(() => new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200 }));
    const res = await sendWeCom({ webhookUrl: WECOM_URL }, payload);
    expect(res.ok).toBe(true);
  });

  it("业务错误码 errcode≠0 判为失败（此前缺字段时才判定，此处补上真实错误码）", async () => {
    stubFetch(() => new Response(JSON.stringify({ errcode: 93000, errmsg: "invalid webhook url" }), { status: 200 }));
    const res = await sendWeCom({ webhookUrl: WECOM_URL }, payload);
    expect(res.ok).toBe(false);
  });

  it("HTTP 非 2xx 判为失败", async () => {
    stubFetch(() => new Response("nope", { status: 500 }));
    const res = await sendWeCom({ webhookUrl: WECOM_URL }, payload);
    expect(res.ok).toBe(false);
  });

  it("网络异常被捕获，不向调用方抛出", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    const res = await sendWeCom({ webhookUrl: WECOM_URL }, payload);
    expect(res.ok).toBe(false);
  });
});

describe("Feishu 驱动", () => {
  it("缺少 webhookUrl 时返回失败", async () => {
    const res = await sendFeishu({ webhookUrl: "" }, payload);
    expect(res.ok).toBe(false);
  });

  it("携带 secret 时按官方算法在请求体附加 timestamp + sign", async () => {
    let body: any = null;
    stubFetch((_u, init) => {
      body = JSON.parse(init?.body ?? "{}");
      return new Response(JSON.stringify({ code: 0, msg: "success" }), { status: 200 });
    });
    await sendFeishu({ webhookUrl: FEISHU_URL, secret: "s3cr3t" }, payload);
    // 飞书自定义机器人签名规范：sign = base64(HMAC-SHA256(key=`<ts>\n<secret>`, msg=""))
    expect(body).toBeTruthy();
    expect(String(body.timestamp)).toMatch(/^\d{10}$/);
    expect(body.sign).toBeTruthy();
  });

  it("无 secret 时不附加签名字段", async () => {
    let body: any = null;
    stubFetch((_u, init) => {
      body = JSON.parse(init?.body ?? "{}");
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    });
    await sendFeishu({ webhookUrl: FEISHU_URL }, payload);
    expect(body.sign).toBeUndefined();
  });

  it("code≠0 判为失败", async () => {
    stubFetch(() => new Response(JSON.stringify({ code: 19021, msg: "sign match fail" }), { status: 200 }));
    const res = await sendFeishu({ webhookUrl: FEISHU_URL, secret: "s3cr3t" }, payload);
    expect(res.ok).toBe(false);
  });

  it("响应体不是合法 JSON 时判为失败而非成功", async () => {
    stubFetch(() => new Response("<html>gateway</html>", { status: 200 }));
    const res = await sendFeishu({ webhookUrl: FEISHU_URL }, payload);
    expect(res.ok).toBe(false);
  });

  it("网络异常被捕获", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("timeout")) as unknown as typeof fetch;
    const res = await sendFeishu({ webhookUrl: FEISHU_URL }, payload);
    expect(res.ok).toBe(false);
  });
});

describe("Bark 驱动", () => {
  it("缺少 deviceKey 时返回失败", async () => {
    const res = await sendBark({ deviceKey: "" }, payload);
    expect(res.ok).toBe(false);
  });

  it("成功时返回 ok", async () => {
    stubFetch(() => new Response(JSON.stringify({ code: 200 }), { status: 200 }));
    const res = await sendBark({ deviceKey: "bark_key_abc" }, payload);
    expect(res.ok).toBe(true);
  });

  it("code≠200 判为失败", async () => {
    stubFetch(() => new Response(JSON.stringify({ code: 400 }), { status: 200 }));
    const res = await sendBark({ deviceKey: "bark_key_abc" }, payload);
    expect(res.ok).toBe(false);
  });

  it("HTTP 非 2xx 判为失败", async () => {
    stubFetch(() => new Response("bad", { status: 404 }));
    const res = await sendBark({ deviceKey: "bark_key_abc" }, payload);
    expect(res.ok).toBe(false);
  });

  it("网络异常被捕获", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ENOTFOUND")) as unknown as typeof fetch;
    const res = await sendBark({ deviceKey: "bark_key_abc" }, payload);
    expect(res.ok).toBe(false);
  });
});

describe("凭据脱敏：企微与飞书的 webhookUrl", () => {
  it("wecom 的 ?key= 被脱敏", () => {
    const out = maskChannelConfig("wecom", { webhookUrl: WECOM_URL });
    expect(out.webhookUrl).not.toContain("wecom_key_abc");
    // 保留 origin 与固定路径，便于运维辨识配置是否指向正确机器人
    expect(out.webhookUrl).toContain("qyapi.weixin.qq.com");
    expect(out.webhookUrl).toContain("/cgi-bin/webhook/send");
  });

  it("feishu 路径末段的 token 被脱敏，secret 字段也被脱敏", () => {
    const out = maskChannelConfig("feishu", { webhookUrl: FEISHU_URL, secret: "s3cr3t" });
    expect(out.webhookUrl).not.toContain("feishu_token_abc");
    expect(out.secret).not.toBe("s3cr3t");
  });

  it("短路径段不被误脱敏（可读性）", () => {
    const out = maskChannelConfig("wecom", { webhookUrl: "https://qyapi.weixin.qq.com/a/b/send" });
    expect(out.webhookUrl).toContain("/a/b/send");
  });

  it("mergeChannelConfig 仅对已知敏感字段回填占位符", () => {
    const existing = { secret: "real-secret", template: "old-tpl" };
    const merged = mergeChannelConfig(
      existing,
      { secret: "***", template: "含 *** 的合法模板" },
      "feishu",
    );
    expect(merged.secret, "敏感字段应保留原值").toBe("real-secret");
    expect(merged.template, "非敏感字段含 *** 不应被静默丢弃").toBe("含 *** 的合法模板");
  });
});
