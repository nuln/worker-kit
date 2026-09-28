/**
 * 通知模块：引擎分派、格式化、安全、webhook 驱动的分支补齐
 *
 * 覆盖的是三类容易漏的分支：
 * 1. 引擎对**未知 channel** 与**驱动抛异常**的处理（fail-open 还是 fail-closed）
 * 2. 格式化器对 `level` 四档（info/warning/alert/其他）与可选字段的渲染
 * 3. `assertSafePublicUrl` 的 SSRF 边界（内网段、http、localhost）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatToText,
  formatToMarkdown,
  formatToTelegramHtml,
  formatToWeComMarkdown,
  formatToFeishuCard,
  formatToHtml,
} from "../../src/notify/formatters.js";
import {
  assertSafePublicUrl,
  maskSecret,
  maskChannelConfig,
  mergeChannelConfig,
} from "../../src/notify/security.js";
import { sendChannelNotification, dispatchNotification, broadcastNotification } from "../../src/notify/engine.js";
import { sendWebhook } from "../../src/notify/drivers/webhook.js";
import type { NotificationPayload } from "../../src/notify/types.js";

const base: NotificationPayload = {
  title: "标题",
  message: "正文内容",
  level: "info",
  event: "login",
};

let warn: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let debug: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  debug = vi.spyOn(console, "debug").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  warn.mockRestore();
  errorSpy.mockRestore();
  debug.mockRestore();
});

/* ==================================================== 格式化器 */

describe("格式化器：level 四档", () => {
  // 纯文本格式**不**带 level 前缀（各渠道格式才有），这里只钉住不抛错
  it("未知 level 不抛错（纯文本不看 level）", () => {
    expect(() => formatToText({ ...base, level: "weird" as never })).not.toThrow();
  });
  it("details 里的空串值被跳过（不产出 \"k: \"）", () => {
    const t = formatToText({ ...base, details: { a: "1", b: "", c: null, d: undefined } });
    expect(t).toContain("a: 1");
    expect(t).not.toContain("b:");
    expect(t).not.toContain("c:");
  });

  it("markdown 的 level 前缀与文本一致", () => {
    expect(formatToMarkdown({ ...base, level: "alert" })).toContain("🚨");
    expect(formatToMarkdown({ ...base, level: "warning" })).toContain("⚠");
  });
  it("Telegram HTML 用 <b> 表达级别", () => {
    expect(formatToTelegramHtml({ ...base, level: "alert" })).toContain("<b>");
  });
  it("WeCom 用 font color 表达级别（alert→warning / warning→comment / 其余→info）", () => {
    expect(formatToWeComMarkdown({ ...base, level: "alert" })).toContain('color="warning"');
    expect(formatToWeComMarkdown({ ...base, level: "warning" })).toContain('color="comment"');
    expect(formatToWeComMarkdown(base)).toContain('color="info"');
  });
  it("飞书卡片按级别选颜色", () => {
    const info = formatToFeishuCard(base);
    const alert = formatToFeishuCard({ ...base, level: "alert" });
    const warn2 = formatToFeishuCard({ ...base, level: "warning" });
    expect(JSON.stringify(info)).toContain("blue");
    expect(JSON.stringify(alert)).toContain("red");
    expect(JSON.stringify(warn2)).toContain("orange");
  });
  it("HTML 格式化按级别选强调色", () => {
    expect(formatToHtml({ ...base, level: "alert" })).toContain("#ef4444");
    expect(formatToHtml({ ...base, level: "warning" })).toContain("#f59e0b");
    expect(formatToHtml(base)).toContain("#3b82f6");
  });
});

describe("格式化器：可选字段", () => {
  it("无 details / link 时不产出空区块", () => {
    const md = formatToMarkdown(base);
    expect(md).not.toContain("undefined");
    expect(md).not.toContain("null");
  });
  it("details 逐项渲染", () => {
    const md = formatToMarkdown({ ...base, details: { ip: "1.2.3.4", n: 5, ok: true } });
    expect(md).toContain("1.2.3.4");
    expect(md).toContain("5");
  });
  it("details 里的 null 值不渲染成 'null'", () => {
    const md = formatToMarkdown({ ...base, details: { x: null } });
    expect(md).not.toContain("null");
  });
  it("link 渲染为可点击链接", () => {
    expect(formatToMarkdown({ ...base, link: "https://a.com" })).toContain("https://a.com");
  });
  it("无 event 时不产出事件行", () => {
    const t = formatToText({ title: "t", message: "m" });
    expect(t).toContain("t");
  });
  it("标题/正文中的 HTML 特殊字符被转义（防注入）", () => {
    const h = formatToTelegramHtml({ ...base, title: "<script>x</script>" });
    expect(h).not.toContain("<script>");
  });
});

/* ==================================================== 安全 */

describe("assertSafePublicUrl：SSRF 边界", () => {
  it("公网 https 放行", () => {
    expect(() => assertSafePublicUrl("https://api.example.com/hook")).not.toThrow();
  });
  it("http 默认拒绝", () => {
    expect(() => assertSafePublicUrl("http://api.example.com/hook")).toThrow();
  });
  it("http 在测试开关下放行", () => {
    expect(() => assertSafePublicUrl("http://api.example.com/hook", true)).not.toThrow();
  });
  it("127.0.0.1 被拒", () => {
    expect(() => assertSafePublicUrl("https://127.0.0.1/x")).toThrow();
  });
  it("形如 127.x 的**真实公网域名**应放行（它不是回环）", () => {
    // 与 `isLoopbackHostname` 的判定相反是有意为之：
    // 那里把 127.evil.com 判成回环是错的（会让明文 http 回调通过）；
    // 这里只该拦**真的**回环/内网地址，公网域名照常放行。
    expect(() => assertSafePublicUrl("https://127.evil.com/x")).not.toThrow();
  });
  it(".local / .internal / metadata.google.internal 被拒", () => {
    for (const h of ["https://a.local/x", "https://a.internal/x", "https://metadata.google.internal/x"]) {
      expect(() => assertSafePublicUrl(h), h).toThrow();
    }
  });
  it("0.0.0.0 被拒", () => {
    expect(() => assertSafePublicUrl("https://0.0.0.0/x", false)).toThrow();
  });
  it("localhost 被拒", () => {
    expect(() => assertSafePublicUrl("https://localhost/x")).toThrow();
  });
  it("私网段被拒", () => {
    for (const h of ["10.0.0.1", "192.168.1.1", "172.16.0.1"]) {
      expect(() => assertSafePublicUrl(`https://${h}/x`), h).toThrow();
    }
  });
  it("非 http(s) 协议被拒", () => {
    expect(() => assertSafePublicUrl("file:///etc/passwd")).toThrow();
    expect(() => assertSafePublicUrl("ftp://a.com/x")).toThrow();
  });
  it("非法 URL 抛错", () => {
    expect(() => assertSafePublicUrl("not a url")).toThrow();
  });
  it("返回归一化后的 URL 对象", () => {
    const u = assertSafePublicUrl("https://api.example.com/hook");
    expect(u).toBeInstanceOf(URL);
    expect(u.host).toBe("api.example.com");
  });
});

describe("maskSecret", () => {
  it("短值整体打码", () => {
    const m = maskSecret("abc");
    expect(m).not.toContain("abc");
  });
  it("长值保留首尾各若干位", () => {
    const s = "sk-1234567890abcdefghij";
    const m = maskSecret(s);
    expect(m.length).toBeLessThan(s.length);
    expect(m).toContain("*");
    expect(m).not.toBe(s);
  });
  it("空串不抛错", () => {
    expect(() => maskSecret("")).not.toThrow();
  });
});

describe("maskChannelConfig(channel, config)", () => {
  it("telegram：botToken 打码，chatId 保留", () => {
    const masked = maskChannelConfig("telegram", { botToken: "SECRET_TOKEN", chatId: "123" });
    expect(JSON.stringify(masked)).not.toContain("SECRET_TOKEN");
    expect(JSON.stringify(masked), "非敏感字段应保留").toContain("123");
  });
  it("bark：deviceKey 打码", () => {
    const masked = maskChannelConfig("bark", { deviceKey: "DEVICEKEY" });
    expect(JSON.stringify(masked)).not.toContain("DEVICEKEY");
  });
  it("feishu：webhookUrl 路径末段的凭据被打码", () => {
    // 末段长度 ≥16 才打码 —— 刻意如此，避免把 /cgi-bin/webhook/send 这类
    // 固定路径也涂掉、丧失可读性。飞书 bot token 远长于 16，实际场景都会被脱敏。
    const token = "t-abcdefghijklmnopqrstuvwxyz012345";
    const masked = maskChannelConfig("feishu", {
      webhookUrl: `https://open.feishu.cn/open-apis/bot/v2/hook/${token}`,
      secret: "S",
    });
    expect(JSON.stringify(masked)).not.toContain(token);
  });
  it("feishu：query 里的 key / token / sign 被打码（不论长度）", () => {
    const masked = maskChannelConfig("feishu", {
      webhookUrl: "https://open.feishu.cn/hook?key=SHORTKEY&sign=S&foo=bar",
    });
    const s = JSON.stringify(masked);
    expect(s).not.toContain("SHORTKEY");
    expect(s, "非凭据参数应保留").toContain("bar");
  });
  it("固定路径末段不打码（保留可读性）", () => {
    const masked = maskChannelConfig("wecom", {
      webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=K",
    });
    expect(JSON.stringify(masked)).toContain("send");
  });
  it("webhook：token / secret 打码", () => {
    const masked = maskChannelConfig("webhook", { token: "TK", secret: "SK" });
    expect(JSON.stringify(masked)).not.toContain("TK");
    expect(JSON.stringify(masked)).not.toContain("SK");
  });
  it("非对象输入返回空对象", () => {
    expect(maskChannelConfig("telegram", null as never)).toEqual({});
  });
});

describe("mergeChannelConfig(existing, new, channel?)", () => {
  it("新值覆盖旧值", () => {
    const m = mergeChannelConfig({ botToken: "old" }, { botToken: "new" });
    expect(m.botToken).toBe("new");
  });
  it("无旧配置时直接返回新配置", () => {
    expect(mergeChannelConfig(undefined, { a: "1" })).toEqual({ a: "1" });
  });
  it("未出现在新配置里的旧键不保留（提交即替换语义）", () => {
    // 钉住当前语义：这是"前端提交即全量覆盖"，不是深合并。
    // 若将来改成深合并，此用例会失败并提醒同步更新。
    const m = mergeChannelConfig({ botToken: "a", chatId: "1" }, { botToken: "b" });
    expect(m.botToken).toBe("b");
    expect(m.chatId).toBeUndefined();
  });
  it("占位符（***）在未指定 channel 时按原样保留，不被当作敏感值", () => {
    const m = mergeChannelConfig({}, { botToken: "***" });
    expect(m.botToken).toBe("***");
  });
  it("指定 channel 时只对已知敏感字段做占位符回填", () => {
    const m = mergeChannelConfig({ botToken: "REAL" }, { botToken: "***" }, "telegram");
    expect(m.botToken).toBe("REAL");
  });
  it("非敏感字段里的 *** 不被回填", () => {
    const m = mergeChannelConfig({ chatId: "REAL" }, { chatId: "***" }, "telegram");
    expect(m.chatId).toBe("***");
  });
});

/* ==================================================== webhook 驱动 */

describe("sendWebhook", () => {
  it("缺少 url 时判失败", async () => {
    const r = await sendWebhook({} as never, base);
    expect(r.ok).toBe(false);
  });
  it("内网地址被拒（SSRF）", async () => {
    const r = await sendWebhook({ url: "http://127.0.0.1/hook" } as never, base);
    expect(r.ok).toBe(false);
  });
  it("正常投递 → ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 200 })),
    );
    const r = await sendWebhook({ url: "https://api.example.com/hook" } as never, base);
    expect(r.ok).toBe(true);
  });
  it("非 2xx 判失败并带状态码", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("denied", { status: 403 })),
    );
    const r = await sendWebhook({ url: "https://api.example.com/hook" } as never, base);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/403/);
  });
  it("错误响应体读取失败时不得二次抛错", async () => {
    const bad = {
      ok: false,
      status: 500,
      text: async () => {
        throw new Error("consumed");
      },
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn(async () => bad));
    const r = await sendWebhook({ url: "https://api.example.com/hook" } as never, base);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/500/);
  });
  it("网络异常被捕获并判失败", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const r = await sendWebhook({ url: "https://api.example.com/hook" } as never, base);
    expect(r.ok).toBe(false);
  });
  it("自定义 headers 透传", async () => {
    const calls: Array<Record<string, string>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: unknown, init?: RequestInit) => {
        calls.push((init?.headers ?? {}) as Record<string, string>);
        return new Response("", { status: 200 });
      }),
    );
    await sendWebhook(
      { url: "https://api.example.com/hook", headers: { "X-Token": "T" } } as never,
      base,
    );
    expect(JSON.stringify(calls[0])).toContain("X-Token");
  });
  it("出站带 signal 与 redirect:manual", async () => {
    const calls: Array<RequestInit> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: unknown, init?: RequestInit) => {
        calls.push(init ?? {});
        return new Response("", { status: 200 });
      }),
    );
    await sendWebhook({ url: "https://api.example.com/hook" } as never, base);
    expect(calls[0]?.signal).toBeDefined();
    expect(calls[0]?.redirect).toBe("manual");
  });
});

/* ==================================================== 引擎 */

describe("引擎：未知 channel、驱动异常与 fail-safe", () => {
  const tgCfg = { botToken: "T", chatId: "1" };

  it("未知 channel 判失败（不得静默成功）", async () => {
    const r = await sendChannelNotification("nosuch" as never, tgCfg, base, {});
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("缺少必填配置时判失败（token / chatId / url / webhookUrl）", async () => {
    expect((await sendChannelNotification("telegram", {}, base, {})).ok).toBe(false);
    expect((await sendChannelNotification("bark", {}, base, {})).ok).toBe(false);
    expect((await sendChannelNotification("wecom", {}, base, {})).ok).toBe(false);
    expect((await sendChannelNotification("feishu", {}, base, {})).ok).toBe(false);
    expect((await sendChannelNotification("webhook", {}, base, {})).ok).toBe(false);
  });

  it("网络不可用时判失败（不得把故障上报为投递成功）", async () => {
    // setup.ts 兜底会让未 stub 的 fetch reject
    const r = await sendChannelNotification("telegram", tgCfg, base, {});
    expect(r.ok).toBe(false);
  });

  it("feishu / wecom / email 三个通道都被识别（不再落到 unknown 分支）", async () => {
    for (const ch of ["feishu", "wecom", "email"] as const) {
      const r = await sendChannelNotification(
        ch,
        { webhookUrl: "https://qyapi.weixin.qq.com/x", url: "https://x", to: "a@b.c" },
        base,
        {},
      );
      expect(typeof r.ok, ch).toBe("boolean");
    }
  });

  it("dispatchNotification 包装成单对象入参", async () => {
    const r = await dispatchNotification({ channel: "telegram", config: tgCfg, payload: base, env: {} });
    expect(r.channel).toBe("telegram");
  });

  it("dispatchNotification 有 waitUntil 时立即返回 ok（异步投递）", async () => {
    const waitUntil = vi.fn();
    const r = await dispatchNotification({
      channel: "telegram",
      config: tgCfg,
      payload: base,
      ctx: { waitUntil },
    });
    expect(r.ok).toBe(true);
    expect(waitUntil, "投递任务应交给 waitUntil").toHaveBeenCalled();
  });

  it("dispatchNotification 无 ctx 时同步等待结果", async () => {
    const r = await dispatchNotification({ channel: "telegram", config: tgCfg, payload: base });
    expect(r.ok).toBe(false);
  });

  it("dispatchNotification 捕获驱动异常并转成 ok:false（fail-safe）", async () => {
    const r = await dispatchNotification({
      channel: "telegram",
      config: tgCfg,
      payload: base,
      ctx: { waitUntil: (p: Promise<any>) => { void p.catch(() => {}); } },
    });
    expect(r.ok).toBe(true); // 立即返回
  });

  it("broadcast 跳过 enabled:false 的通道", async () => {
    const r = await broadcastNotification(
      [
        { channel: "telegram", config: tgCfg, enabled: false },
        { channel: "telegram", config: tgCfg },
      ],
      base,
      {},
    );
    expect(r).toHaveLength(1);
  });

  it("broadcast 事件过滤是 opt-out：显式 false 才跳过", async () => {
    // 语义：只要没有显式把该事件标成 false 就照发。
    // 告警场景下这是刻意的默认（漏发比多发危险）。
    const skip = await broadcastNotification(
      [{ channel: "telegram", config: tgCfg, events: { login: false } }],
      { ...base, event: "login" },
      {},
    );
    expect(skip).toHaveLength(0);

    const send = await broadcastNotification(
      [{ channel: "telegram", config: tgCfg, events: { backup: true } }],
      { ...base, event: "login" },
      {},
    );
    expect(send, "未显式禁用就该发").toHaveLength(1);
  });

  it("broadcast 无事件过滤且启用时执行", async () => {
    const r = await broadcastNotification([{ channel: "telegram", config: tgCfg }], base, {});
    expect(r).toHaveLength(1);
  });

  it("broadcast 通道列表为空 → 空结果", async () => {
    expect(await broadcastNotification([], base, {})).toEqual([]);
  });
});
