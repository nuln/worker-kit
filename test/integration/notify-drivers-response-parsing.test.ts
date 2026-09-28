/**
 * 通知驱动的响应解析与出站加固测试
 *
 * ## 为什么专门补这一块
 *
 * 三个驱动的**函数覆盖率只有 33%** —— 未覆盖的全是「读响应体再判成败」这类代码：
 *
 * - 第三方返回非 JSON 时必须判失败（`res.json().catch(() => null)`）
 * - 错误响应体读取失败时不得二次抛错
 * - 可选字段（group / sound / icon / badge / link）是否正确透传
 * - 校验失败时的错误信息
 *
 * 这些路径一旦退化，表现是**告警静默丢失**：调用方收到 `ok: true`，
 * 而消息从未送达 —— 与网络故障被上报为「投递成功」是同一类 fail-open。
 *
 * ## 显式声明 MOCK_EXTERNAL_API 时的短路
 *
 * 三个驱动都有「仅接受显式 `MOCK_EXTERNAL_API=true` 才短路」的分支。
 * 这条必须钉死：它曾经的实现是 `url.includes("mock")` 子串猜测 ——
 * 生产把 mock 写进 URL 路径就会命中，只打日志后返回 `ok: true`。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendTelegram } from "../../src/notify/drivers/telegram.js";
import { sendBark } from "../../src/notify/drivers/bark.js";
import { sendWeCom } from "../../src/notify/drivers/wecom.js";
import type { NotificationPayload } from "../../src/notify/types.js";

const PAYLOAD: NotificationPayload = {
  title: "测试标题",
  message: "测试正文",
  level: "info",
  event: "login",
  timestamp: Date.now(),
};

/** 记录请求并返回指定响应 */
function stubFetch(responder: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input?.url ?? input);
      calls.push({ url, init });
      return responder(url, init);
    }),
  );
  return calls;
}

let warn: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let debug: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  debug = vi.spyOn(console, "debug").mockImplementation(() => {});
  delete process.env.MOCK_EXTERNAL_API;
});
afterEach(() => {
  vi.unstubAllGlobals();
  warn.mockRestore();
  errorSpy.mockRestore();
  debug.mockRestore();
  delete process.env.MOCK_EXTERNAL_API;
});

/* ==================================================== Telegram */

describe("sendTelegram：响应解析", () => {
  const cfg = { botToken: "TOKEN", chatId: "123" } as never;

  it("缺少 botToken / chatId 时判失败且不发请求", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const a = await sendTelegram({ botToken: "", chatId: "1" } as never, PAYLOAD);
    const b = await sendTelegram({ botToken: "t", chatId: "" } as never, PAYLOAD);
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(calls.length).toBe(0);
  });

  it("HTTP 200 但响应体缺 result → 判失败（不得谎报投递成功）", async () => {
    // 回归用例：注释声称"缺少 result 字段时判为失败"，代码却只判 data.ok === false，
    // 于是 `{}` 这种 200 响应会返回 ok:true + messageId:undefined —— fail-open。
    stubFetch(() => new Response("{}", { status: 200 }));
    const r = await sendTelegram(cfg, PAYLOAD);
    expect(r.ok, "缺 result 不得判成功").toBe(false);
    expect(r.error).toContain("result");
  });

  it("成功时返回 ok 并带上 messageId", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 }),
    );
    const r = await sendTelegram(cfg, PAYLOAD);
    expect(r.ok).toBe(true);
    expect(r.messageId).toBeDefined();
  });

  it("Telegram 返回非 JSON → 必须判失败（不得当成成功）", async () => {
    stubFetch(() => new Response("<html>gateway</html>", { status: 200 }));
    const r = await sendTelegram(cfg, PAYLOAD);
    expect(r.ok, "非 JSON 响应体必须判失败").toBe(false);
    expect(r.error).toContain("非 JSON");
  });

  it("Telegram 返回 ok:false 时把 description 带出来", async () => {
    stubFetch(
      () => new Response(JSON.stringify({ ok: false, description: "chat not found" }), { status: 200 }),
    );
    const r = await sendTelegram(cfg, PAYLOAD);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("chat not found");
  });

  it("HTTP 4xx/5xx 时错误信息含状态码", async () => {
    stubFetch(() => new Response("rate limited", { status: 429 }));
    const r = await sendTelegram(cfg, PAYLOAD);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/429/);
  });

  it("错误响应体读取失败时不得二次抛错", async () => {
    const bad = {
      ok: false,
      status: 500,
      text: async () => {
        throw new Error("consumed");
      },
    } as unknown as Response;
    stubFetch(() => bad);
    const r = await sendTelegram(cfg, PAYLOAD);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/500/);
  });

  it("网络异常（fetch reject）必须被捕获并判失败", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const r = await sendTelegram(cfg, PAYLOAD);
    expect(r.ok, "网络故障绝不能被上报为投递成功").toBe(false);
  });

  it("出站请求禁用自动重定向（否则 SSRF 首跳校验形同虚设）", async () => {
    const calls = stubFetch(
      () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 }),
    );
    await sendTelegram(cfg, PAYLOAD);
    expect((calls[0]?.init as RequestInit)?.redirect).toBe("manual");
  });

  it("出站请求带超时 signal", async () => {
    const calls = stubFetch(
      () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 }),
    );
    await sendTelegram(cfg, PAYLOAD);
    expect((calls[0]?.init as RequestInit)?.signal).toBeDefined();
  });

  it.each([
    ["telegram", (c: unknown) => sendTelegram(c as never, PAYLOAD), { botToken: "T", chatId: "1" }],
    ["bark", (c: unknown) => sendBark(c as never, PAYLOAD), { deviceKey: "K", server: "https://api.day.app" }],
    ["wecom", (c: unknown) => sendWeCom(c as never, PAYLOAD), { webhookUrl: "https://qyapi.weixin.qq.com/x" }],
  ])("%s：出站必须同时带超时 signal 与 redirect:manual", async (name, send, conf) => {
    // 回归用例：这层加固曾只写在注释里、代码没实现 ——
    // 注释声称"5s 超时 + 禁止自动重定向"，实际 fetch 两样都没有。
    // 后果：① 第三方端点挂起会永久占用请求；
    //       ② 默认 redirect:"follow" 让公网 URL 302 到内网地址，
    //          assertSafePublicUrl 只校验首跳，SSRF 形同虚设。
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    await send(conf);
    const init = calls[0]?.init as RequestInit;
    expect(init?.signal, `${name} 缺少超时 signal`).toBeDefined();
    expect(init?.redirect, `${name} 缺少 redirect:manual`).toBe("manual");
  });

  it("URL 中的 botToken 被编码（不原样拼进路径）", async () => {
    const calls = stubFetch(
      () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 }),
    );
    await sendTelegram({ botToken: "a/b c", chatId: "1" } as never, PAYLOAD);
    expect(calls[0]?.url).toContain(encodeURIComponent("a/b c"));
    expect(calls[0]?.url).not.toContain("a/b c");
  });
});

/* ==================================================== Bark */

describe("sendBark：参数透传与响应解析", () => {
  const cfg = { deviceKey: "DEVICEKEY", server: "https://api.day.app" } as never;

  it("缺少 server 时判失败", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const r = await sendBark({ deviceKey: "" } as never, PAYLOAD);
    expect(r.ok).toBe(false);
    expect(calls.length).toBe(0);
  });

  it("非法 server 协议被拒绝（错误信息含原因）", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const r = await sendBark({ deviceKey: "K", server: "javascript:alert(1)" } as never, PAYLOAD);
    expect(r.ok).toBe(false);
    expect(calls.length, "非法协议不得发出请求").toBe(0);
  });

  it("可选字段 group / sound / icon / badge / link 均透传到请求体", async () => {
    const calls = stubFetch(
      () => new Response(JSON.stringify({ code: 200, message: "success" }), { status: 200 }),
    );
    await sendBark(
      {
        deviceKey: "DEVICEKEY",
        server: "https://api.day.app",
        group: "ops",
        sound: "bell",
        icon: "https://i/x.png",
      } as never,
      { ...PAYLOAD, link: "https://example.com" } as NotificationPayload,
    );
    const body = JSON.parse(String((calls[0]?.init as RequestInit).body));
    expect(body.group).toBe("ops");
    expect(body.sound).toBe("bell");
    expect(body.icon).toBe("https://i/x.png");
    expect(body.url, "payload.link 应映射为 body.url").toBe("https://example.com");
  });

  it("badge 为 0 时也要透传（0 是 falsy，容易被漏掉）", async () => {
    const calls = stubFetch(
      () => new Response(JSON.stringify({ code: 200, message: "success" }), { status: 200 }),
    );
    await sendBark({ deviceKey: "DEVICEKEY", server: "https://api.day.app", badge: 0 } as never, PAYLOAD);
    const body = JSON.parse(String((calls[0]?.init as RequestInit).body));
    expect(body.badge, "badge=0 是有效值，不得被 falsy 判断吞掉").toBe(0);
  });

  it("未提供的可选字段不出现在请求体里", async () => {
    const calls = stubFetch(
      () => new Response(JSON.stringify({ code: 200, message: "success" }), { status: 200 }),
    );
    await sendBark(cfg, PAYLOAD);
    const body = JSON.parse(String((calls[0]?.init as RequestInit).body));
    for (const k of ["group", "sound", "icon", "url"]) {
      expect(Object.keys(body), `${k} 不应出现`).not.toContain(k);
    }
  });

  it("Bark 返回非 JSON → 判失败", async () => {
    stubFetch(() => new Response("<html>502</html>", { status: 200 }));
    const r = await sendBark(cfg, PAYLOAD);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("非 JSON");
  });

  it("Bark 返回 code != 200 时判失败并带出 message", async () => {
    stubFetch(
      () => new Response(JSON.stringify({ code: 400, message: "bad device key" }), { status: 200 }),
    );
    const r = await sendBark(cfg, PAYLOAD);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("bad device key");
  });

  it("错误响应体读取失败时不得二次抛错", async () => {
    const bad = {
      ok: false,
      status: 502,
      text: async () => {
        throw new Error("consumed");
      },
    } as unknown as Response;
    stubFetch(() => bad);
    const r = await sendBark(cfg, PAYLOAD);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/502/);
  });
});

/* ==================================================== WeCom */

describe("sendWecom：响应解析", () => {
  const cfg = { webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=K" } as never;

  it("缺少 webhookUrl 时判失败且不发请求", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const r = await sendWeCom({ webhookUrl: "" } as never, PAYLOAD);
    expect(r.ok).toBe(false);
    expect(calls.length).toBe(0);
  });

  it("errcode 非 0 时判失败并带出 errmsg", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ errcode: 93000, errmsg: "invalid webhook key" }), {
          status: 200,
        }),
    );
    const r = await sendWeCom(cfg, PAYLOAD);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("invalid webhook key");
  });

  it("WeCom 返回非 JSON → 判失败", async () => {
    stubFetch(() => new Response("<html>waf</html>", { status: 200 }));
    const r = await sendWeCom(cfg, PAYLOAD);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("非 JSON");
  });

  it("错误响应体读取失败时不得二次抛错", async () => {
    const bad = {
      ok: false,
      status: 500,
      text: async () => {
        throw new Error("consumed");
      },
    } as unknown as Response;
    stubFetch(() => bad);
    const r = await sendWeCom(cfg, PAYLOAD);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/500/);
  });

  it("网络异常被捕获并判失败", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ETIMEDOUT");
      }),
    );
    const r = await sendWeCom(cfg, PAYLOAD);
    expect(r.ok).toBe(false);
  });
});

/* ============================================ MOCK 替身短路 */

describe("MOCK_EXTERNAL_API 短路：只认显式 true", () => {
  const cases: Array<[string, (c?: unknown) => Promise<{ ok: boolean; messageId?: string }>]> = [
    ["telegram", (c) => sendTelegram(c as never, PAYLOAD)],
    ["bark", (c) => sendBark(c as never, PAYLOAD)],
    ["wecom", (c) => sendWeCom(c as never, PAYLOAD)],
  ];

  const cfgFor = (name: string) =>
    name === "telegram"
      ? ({ botToken: "T", chatId: "1" } as never)
      : name === "bark"
        ? ({ deviceKey: "DEVICEKEY", server: "https://api.day.app" } as never)
        : ({ webhookUrl: "https://qyapi.weixin.qq.com/x" } as never);

  it.each(cases)("%s：显式 true 时短路且不发请求", async (name, send) => {
    process.env.MOCK_EXTERNAL_API = "true";
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const r = await send(cfgFor(name));
    expect(r.ok).toBe(true);
    expect(r.messageId).toContain("mock");
    expect(calls.length, "短路时不得发请求").toBe(0);
  });

  it.each(cases)("%s：其他取值一律不短路", async (name, send) => {
    for (const v of ["1", "yes", "TRUE", "true ", "false", ""]) {
      delete process.env.MOCK_EXTERNAL_API;
      process.env.MOCK_EXTERNAL_API = v;
      // 桩返回 200 空对象：三个驱动都应判失败（无 result / code!=200 / errcode!=0）
      const calls = stubFetch(() => new Response("{}", { status: 200 }));
      const r = await send(cfgFor(name));
      expect(calls.length, `MOCK_EXTERNAL_API=${JSON.stringify(v)} 不该短路`).toBe(1);
      expect(r.ok, `${name} 未短路时不应谎报成功`).toBe(false);
      expect(r.messageId, "未短路就不该有 mock messageId").toBeUndefined();
    }
  });

  it.each(cases)("%s：URL 里含 mock 字样也不短路", async (name, send) => {
    delete process.env.MOCK_EXTERNAL_API;
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    // 把配置里的地址改成含 "mock" 的路径
    const cfg =
      name === "bark"
        ? ({ deviceKey: "DEVICEKEY", server: "https://api.example.com/mock/v1" } as never)
        : name === "wecom"
          ? ({ webhookUrl: "https://qyapi.weixin.qq.com/mock?key=K" } as never)
          : ({ botToken: "mock", chatId: "1" } as never);
    await send(cfg);
    expect(calls.length, "子串含 mock 不得被当成测试替身").toBe(1);
  });
});
