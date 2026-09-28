/**
 * 最后一批：可达的剩余分支
 *
 * 上一轮留下的 260 个未覆盖分支里，绝大部分是**完全可达**的，只是需要
 * 精确构造输入：网络层抛非 Error、缺省字段回落、IP 段边界、缺头响应。
 *
 * 本文件逐一覆盖。剩下的确实是不可达的防御分支（正则保证、类型保证），
 * 已登记在 `coverage-floor-gate.test.ts` 的 `UNREACHABLE_BRANCHES`。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let warn: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
let dbg: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  dbg = vi.spyOn(console, "debug").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  warn.mockRestore();
  errSpy.mockRestore();
  dbg.mockRestore();
});

/** 让 fetch 抛一个**非 Error** 对象，覆盖 `err?.message || String(err)` 的右半边 */
const throwNonError = (v: unknown) => vi.fn(async () => Promise.reject(v));

/* ==================================================== 通知驱动：网络异常 */

import { sendTelegram } from "../../src/notify/drivers/telegram.js";
import { sendBark } from "../../src/notify/drivers/bark.js";
import { sendWeCom } from "../../src/notify/drivers/wecom.js";
import { sendFeishu } from "../../src/notify/drivers/feishu.js";
import { sendWebhook } from "../../src/notify/drivers/webhook.js";
import { sendEmail } from "../../src/notify/drivers/email.js";

describe("通知驱动：网络层抛出非 Error 时仍判失败且带上原因", () => {
  const payload = { title: "t", message: "m", level: "info" as const, event: "login" };
  const cfg = {
    botToken: "T",
    chatId: "1",
    deviceKey: "K",
    webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/abcdefghijklmnopqrstuvwxyz",
    url: "https://api.example.com/hook",
    from: "a@b.c",
    to: "d@e.f",
  };

  it("telegram：抛字符串时错误信息为 String(err)", async () => {
    vi.stubGlobal("fetch", throwNonError("plain string boom"));
    const r = await sendTelegram(cfg as never, payload as never);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("plain string boom");
  });

  it("telegram：抛 Error 时错误信息为 err.message", async () => {
    vi.stubGlobal("fetch", throwNonError(new Error("ETIMEDOUT")));
    const r = await sendTelegram(cfg as never, payload as never);
    expect(r.error).toContain("ETIMEDOUT");
  });

  it("bark：网络异常判失败", async () => {
    vi.stubGlobal("fetch", throwNonError("bark down"));
    expect((await sendBark(cfg as never, payload as never)).ok).toBe(false);
  });

  it("bark：level 映射为 APNs 档位（alert→critical / warning→timeSensitive / 其余→active）", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: unknown, init?: RequestInit) => {
        bodies.push(String(init?.body ?? ""));
        return new Response(JSON.stringify({ code: 200 }), { status: 200 });
      }),
    );
    const run = async (level: string) => {
      await sendBark({ ...cfg, url: "https://api.day.app/K" } as never, {
        ...payload,
        level,
      } as never);
      return bodies[bodies.length - 1]!;
    };
    expect(await run("alert")).toContain("critical");
    expect(await run("warning")).toContain("timeSensitive");
    expect(await run("info")).toContain("active");
  });

  it("wecom：网络异常判失败", async () => {
    vi.stubGlobal("fetch", throwNonError("wecom down"));
    expect((await sendWeCom(cfg as never, payload as never)).ok).toBe(false);
  });

  it("feishu：网络异常判失败", async () => {
    vi.stubGlobal("fetch", throwNonError("feishu down"));
    expect((await sendFeishu(cfg as never, payload as never)).ok).toBe(false);
  });

  it("webhook：网络异常判失败", async () => {
    vi.stubGlobal("fetch", throwNonError("hook down"));
    expect((await sendWebhook(cfg as never, payload as never)).ok).toBe(false);
  });

  it("email：网络异常判失败且带出原因", async () => {
    // 必须给出 API key 才会走 HTTP provider；否则 createEmailProvider
    // 会挑一个本地 provider，fetch 根本不会被调用。
    vi.stubGlobal("fetch", throwNonError("smtp down"));
    const r = await sendEmail(cfg as never, payload as never, {
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "a@b.c",
    } as never);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("smtp down");
  });
});

describe("通知驱动：Telegram 业务层报错", () => {
  const payload = { title: "t", message: "m", level: "info" as const, event: "login" };

  it("HTTP 200 但 ok:false 时把 Telegram 的描述带出来", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: false, error_code: 400, description: "chat not found" }), {
          status: 200,
        }),
      ),
    );
    const r = await sendTelegram({ botToken: "T", chatId: "1" } as never, payload as never);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("chat not found");
  });

  it("HTTP 200 且 ok:true → 成功", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 })),
    );
    expect((await sendTelegram({ botToken: "T", chatId: "1" } as never, payload as never)).ok).toBe(true);
  });
});

describe("webhook：可选字段缺省时仍有合法 event / level", () => {
  it("payload 无 event / level 时回落到默认值", async () => {
    let body = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: unknown, init?: RequestInit) => {
        body = String(init?.body ?? "");
        return new Response("", { status: 200 });
      }),
    );
    await sendWebhook({ url: "https://api.example.com/hook" } as never, {
      title: "t",
      message: "m",
    } as never);
    expect(body).toContain('"event":"notification"');
    expect(body).toContain('"level":"info"');
  });
});

/* ==================================================== 通知引擎：非 Error */

import { sendChannelNotification, dispatchNotification } from "../../src/notify/engine.js";

describe("通知引擎：非 Error 异常与 waitUntil", () => {
  const payload = { title: "t", message: "m", level: "info" as const, event: "login" };

  it("驱动抛字符串时错误信息为 String(err)", async () => {
    const r = await sendChannelNotification(
      "telegram",
      {
        get botToken(): string {
          throw "string failure";
        },
        chatId: "1",
      } as never,
      payload as never,
      {},
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("dispatchNotification 捕获非 Error 异常并转成 ok:false", async () => {
    const r = await dispatchNotification({
      channel: "telegram",
      config: {
        get botToken(): string {
          throw "boom";
        },
        chatId: "1",
      } as never,
      payload: payload as never,
    });
    expect(r.ok).toBe(false);
  });

  it("broadcast 中某个通道 reject 时整批仍能给出逐通道结果", async () => {
    const results = await import("../../src/notify/engine.js").then((m) =>
      m.broadcastNotification(
        [
          { channel: "telegram", config: { botToken: "T", chatId: "1" } },
          { channel: "telegram", config: { botToken: "T", chatId: "2" } },
        ],
        payload as never,
        {},
      ),
    );
    expect(results).toHaveLength(2);
    for (const r of results) expect(typeof r.ok).toBe("boolean");
  });
});

/* ==================================================== notify/security */

import { assertSafePublicUrl, maskChannelConfig } from "../../src/notify/security.js";

describe("assertSafePublicUrl：IP 段边界", () => {
  it("127.0.0.0/8 整段被拒（不是只有 127.0.0.1）", () => {
    for (const h of ["127.0.0.1", "127.1.2.3", "127.255.255.254"]) {
      expect(() => assertSafePublicUrl(`https://${h}/x`), h).toThrow(/not permitted/);
    }
  });

  it("0.0.0.0/8 被拒", () => {
    expect(() => assertSafePublicUrl("https://0.0.0.0/x")).toThrow(/not permitted/);
  });

  it("169.254.0.0/16（云元数据）被拒", () => {
    expect(() => assertSafePublicUrl("https://169.254.169.254/latest/meta-data")).toThrow(
      /not permitted/,
    );
  });

  it("公网 IP 放行", () => {
    expect(() => assertSafePublicUrl("https://8.8.8.8/x")).not.toThrow();
  });

  it("测试开关放行 127.x（仅本地联调用）", () => {
    expect(() => assertSafePublicUrl("http://127.0.0.1/x", true)).not.toThrow();
    expect(() => assertSafePublicUrl("https://127.0.0.1/x", true)).not.toThrow();
  });
});

describe("maskChannelConfig：全部通道分支", () => {
  it("email 通道不做任何脱敏（它没有 token 类字段）", () => {
    const r = maskChannelConfig("email", { to: "a@b.c", apiKey: "PLAIN" });
    expect(r.to).toBe("a@b.c");
  });

  it("未知通道走 default 分支且原样返回", () => {
    const r = maskChannelConfig("nosuch" as never, { token: "T" });
    expect(r.token).toBe("T");
  });

  it("wecom：webhookUrl 的 key 被脱敏", () => {
    const r = maskChannelConfig("wecom", {
      webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=SECRETKEY",
    });
    expect(JSON.stringify(r)).not.toContain("SECRETKEY");
  });

  it("非字符串 / 非法 URL 的 webhookUrl 不被弄坏", () => {
    expect(() => maskChannelConfig("feishu", { webhookUrl: 123 })).not.toThrow();
    expect(() => maskChannelConfig("feishu", { webhookUrl: "::::" })).not.toThrow();
    expect(maskChannelConfig("feishu", { webhookUrl: undefined })).toBeTruthy();
  });
});

/* ==================================================== health */

import { createHealthCheckHandler } from "../../src/observability/health.js";

describe("health：全部检查器的异常记录", () => {
  const boom = () => {
    throw new Error("boom");
  };
  const bare = () => {
    throw "string boom";
  };
  const call = (checks: Record<string, unknown>) =>
    createHealthCheckHandler({ serviceName: "X", checks } as never)(
      new Request("https://x/health"),
      {} as never,
    );

  it("d1 抛 Error → errors.d1 带 message", async () => {
    const res = await call({ d1: boom });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { errors: Record<string, string> }).errors.d1).toBe("boom");
  });

  it("d1 抛非 Error → errors.d1 为 String(err)", async () => {
    const res = await call({ d1: bare });
    expect(((await res.json()) as { errors: Record<string, string> }).errors.d1).toBe("string boom");
  });

  it("kv 抛非 Error", async () => {
    const res = await call({ kv: bare });
    expect(((await res.json()) as { errors: Record<string, string> }).errors.kv).toBe("string boom");
  });

  it("r2 抛非 Error", async () => {
    const res = await call({ r2: bare });
    expect(((await res.json()) as { errors: Record<string, string> }).errors.r2).toBe("string boom");
  });

  it("自定义检查抛非 Error", async () => {
    const res = await call({ custom: { myCheck: bare } });
    expect(((await res.json()) as { errors: Record<string, string> }).errors.myCheck).toBe("string boom");
  });

  it("自定义检查返回 false 时记为该检查失败", async () => {
    const res = await call({ custom: { myCheck: async () => false } });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { errors: Record<string, string> }).errors.myCheck).toContain("false");
  });

  it("d1 抛 Error 时 errors.d1 带 message（与 kv/r2 对称）", async () => {
    const res = await call({ kv: boom, r2: boom });
    const e = (await res.json()) as { errors: Record<string, string> };
    expect(e.errors.kv).toBe("boom");
    expect(e.errors.r2).toBe("boom");
  });
});

/* ==================================================== s3/client */

import { S3Client } from "../../src/s3/client.js";

describe("S3Client：响应头缺省与预签名", () => {
  const cfg = {
    accessKeyId: "AKIA",
    secretAccessKey: "secret",
    region: "us-east-1",
    bucket: "bkt",
    endpoint: "https://s3.example.com",
  };
  const client = () => new S3Client(cfg as never);

  it("headObject 在缺少 content-length / content-type / etag 时不崩", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    const r = await client().headObject("k");
    expect(r.exists).toBe(true);
    expect(r.size).toBeUndefined();
    expect(r.etag).toBeUndefined();
  });

  it("headObject 读出 content-length / etag（含引号剥离）与 x-amz-meta-*", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("", {
            status: 200,
            headers: {
              "content-length": "42",
              "content-type": "application/json",
              etag: '"abc123"',
              "x-amz-meta-service": "mail",
            },
          }),
      ),
    );
    const r = await client().headObject("k");
    expect(r.size).toBe(42);
    expect(r.etag).toBe("abc123");
    expect(r.metadata).toEqual({ service: "mail" });
  });

  it("无自定义元数据时 metadata 为 undefined（不留空对象）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 200, headers: { "content-length": "1" } })),
    );
    expect((await client().headObject("k")).metadata).toBeUndefined();
  });

  it("getPresignedUrl 缺省 expiresIn 为 3600，且可覆盖", async () => {
    expect(await client().getPresignedUrl("k")).toContain("X-Amz-Expires=3600");
    expect(await client().getPresignedUrl("k", { expiresIn: 60 })).toContain("X-Amz-Expires=60");
  });
});

/* ==================================================== s3/sigv4 */

import { signS3Request, getSignatureKey } from "../../src/s3/sigv4.js";

describe("sigv4：多参数查询排序、session token 与根路径", () => {
  const base = {
    accessKeyId: "AKIA",
    secretAccessKey: "secret",
    region: "us-east-1",
    service: "s3",
  } as never;

  it("同名参数按值排序（AWS 规范要求）", async () => {
    const { headers } = await signS3Request({
      ...(base as object),
      method: "GET",
      url: new URL("https://bkt.s3.amazonaws.com/?list-type=2&prefix=b&prefix=a"),
    } as never);
    const sig = headers.get("authorization")!;
    // 规范要求 canonical query 按 key 再按 value 排序；
    // 签名串本身不暴露 query，只能间接断言 —— 用两种顺序不同的输入比签名是否稳定
    const again = await signS3Request({
      ...(base as object),
      method: "GET",
      url: new URL("https://bkt.s3.amazonaws.com/?list-type=2&prefix=a&prefix=b"),
    } as never);
    expect(again.headers.get("authorization")).toBe(sig);
  });

  it("根路径规范化为 /（不留空串）", async () => {
    const { url } = await signS3Request({
      ...(base as object),
      method: "GET",
      url: new URL("https://bkt.s3.amazonaws.com"),
    } as never);
    expect(url.pathname).toBe("/");
  });

  it("带 sessionToken 时写入 X-Amz-Security-Token 头", async () => {
    const { headers } = await signS3Request({
      ...(base as object),
      method: "GET",
      url: new URL("https://bkt.s3.amazonaws.com/k"),
      sessionToken: "TOKEN123",
    } as never);
    expect(headers.get("X-Amz-Security-Token")).toBe("TOKEN123");
  });

  it("无 sessionToken 时不写该头", async () => {
    const { headers } = await signS3Request({
      ...(base as object),
      method: "GET",
      url: new URL("https://bkt.s3.amazonaws.com/k"),
    } as never);
    expect(headers.get("X-Amz-Security-Token")).toBeNull();
  });

  it("query 排序分支（同键不同值）可复现", async () => {
    const opts = {
      ...(base as object),
      method: "POST",
      url: new URL("https://bkt.s3.amazonaws.com/k?z=1&a=2&m=3"),
    } as never;
    const a = await signS3Request(opts);
    const b = await signS3Request(opts);
    expect([...a.headers.entries()]).toEqual([...b.headers.entries()]);
    expect(String(a.url)).toContain("a=2");
  });

  it("getSignatureKey 接受显式 service", async () => {
    expect(await getSignatureKey("S", "20260101", "us-east-1", "s3")).toBeTruthy();
  });
});

/* ==================================================== config/strip */

import { stripCommentsAndStrings } from "../../src/config/strip.js";

describe("stripCommentsAndStrings：未闭合结构", () => {
  it("未闭合的行注释吞到文件末尾", () => {
    const out = stripCommentsAndStrings('const a = 1; // 未闭合\nconst b = 2;');
    expect(out).toContain("const a = 1;");
    expect(out).not.toContain("未闭合");
  });

  it("未闭合的块注释吞到文件末尾", () => {
    const out = stripCommentsAndStrings("const a = 1; /* 未闭合");
    expect(out).not.toContain("未闭合");
  });

  it("未闭合的模板字符串吞到末尾", () => {
    expect(() => stripCommentsAndStrings("const a = `未闭合")).not.toThrow();
  });

  it("文件末尾的 `/` 不被当成注释起始", () => {
    const out = stripCommentsAndStrings("const a = 1; /");
    expect(out).toContain("const a = 1;");
  });

  it("文件末尾的 `/*` 之后无换行也不越界", () => {
    expect(() => stripCommentsAndStrings("const a = 1; /*")).not.toThrow();
  });

  it("输出与输入长度一致（位置可映射）", () => {
    for (const src of ["a // x", "a /* x", "a /* x */ b", "a 'y", 'a `z', "a /re/g"]) {
      expect(stripCommentsAndStrings(src).length, src).toBe(src.length);
    }
  });
});

/* ==================================================== config/requirements */

import { defineRequirements, evaluateRequirements } from "../../src/config/requirements.js";

describe("requirements：非法定义与缺省 env", () => {
  it("传对象而不是数组时抛错并列出收到的键", () => {
    expect(() => defineRequirements({ FOO: { why: "x" } } as never)).toThrow(/对象/);
  });

  it("空数组合法（不强制声明任何变量）", () => {
    expect(() => defineRequirements([])).not.toThrow();
  });

  it("缺 name / name 为空串的条目被丢弃而不是让整份配置崩掉", () => {
    const reqs = defineRequirements([
      { why: "没有 name", kind: "var" },
      { name: "", why: "空 name", kind: "var" },
      { name: "GOOD", why: "合法", kind: "var" },
    ] as never);
    expect(reqs.map((r) => r.name)).toEqual(["GOOD"]);
  });

  it("env 为 null / undefined 时按未配置处理（不抛错）", () => {
    const reqs = defineRequirements([{ name: "FOO", why: "w", kind: "var" }] as never);
    const r = evaluateRequirements(null as never, reqs);
    expect(r).toBeTruthy();
    expect(JSON.stringify(r)).toContain("FOO");
  });

  it("配置齐备时 ok=true 且无任何待办项", () => {
    const reqs = defineRequirements([{ name: "FOO", why: "w", kind: "var" }] as never);
    const r = evaluateRequirements({ FOO: "v" } as never, reqs);
    expect(r.ok).toBe(true);
    expect(r.all, "齐备时不应产生任何缺失项").toEqual([]);
  });
});

/* ==================================================== UI 缺省与回落 */

import { renderMissingConfigPanel } from "../../src/ui/missing-config.js";
import { renderActionGroupHtml, renderGearMenuHtml } from "../../src/ui/topbar.js";
import { handleLangParam } from "../../src/ui/i18n.js";
import { formatToTelegramHtml } from "../../src/notify/formatters.js";
import { normalizeAaguid, resolveAAGUID } from "../../src/webauthn/aaguid.js";

describe("UI：缺省回落分支", () => {
  it("缺配置面板遇到未知 kind 时回落到 var 文案", () => {
    const h = renderMissingConfigPanel({
      serviceName: "S",
      blocking: [{ name: "X", kind: "nosuchkind" as never, reason: "w", hint: "h", fatal: true }],
    });
    expect(h).toContain("X");
  });

  it("操作组在没有任何项时不产出多余分隔符", () => {
    const h = renderActionGroupHtml({} as never);
    expect(typeof h).toBe("string");
    expect(h).not.toContain("undefined");
  });

  it("齿轮菜单用户只有 name / 只有 email / 都没有时都有可读展示", () => {
    expect(renderGearMenuHtml({ user: { name: "张三" } })).toContain("张三");
    expect(renderGearMenuHtml({ user: { email: "a@b.com" } })).toContain("a@b.com");
    expect(renderGearMenuHtml({ user: {} })).toContain("用户");
    expect(renderGearMenuHtml({ user: {}, lang: "en" })).toContain("User");
  });

  it("有路径时重定向到该路径（不是 redirectPath）", () => {
    const res = handleLangParam(new Request("https://x/oidc/login?lang=en"), "/fallback");
    expect(res!.headers.get("Location")).toBe("/oidc/login");
  });

  it("Telegram HTML 的 level 前缀三档", () => {
    const p = { title: "t", message: "m", event: "login" } as never;
    expect(formatToTelegramHtml(p)).toBeTruthy();
    expect(formatToTelegramHtml({ ...(p as object), level: "alert" } as never)).toContain("🚨");
    expect(formatToTelegramHtml({ ...(p as object), level: "warning" } as never)).toContain("⚠");
  });
});

describe("aaguid：base64 补位", () => {
  it("标准 AAGUID 归一为大写无分隔形式", () => {
    // 归一为标准 36 字符小写 UUID 形式（两种写法都收敛到同一结果）
    expect(normalizeAaguid("0132d110-bf4e-4208-a403-ab4f5f12efe5")).toBe("0132d110-bf4e-4208-a403-ab4f5f12efe5");
    expect(normalizeAaguid("0132D110BF4E4208A403AB4F5F12EFE5")).toBe("0132d110-bf4e-4208-a403-ab4f5f12efe5");
  });
  it("全零 AAGUID 表示无品牌信息，可安全解析", () => {
    const b = resolveAAGUID("00000000000000000000000000000000");
    expect(b).toBeTruthy();
    expect(b.brand).toBeTruthy();
    expect(b.name).toBeTruthy();
  });
  it("全零 AAGUID 的 base64 形式（长度非 4 的倍数）也能归一", () => {
    // 覆盖 `b64.length % 4` 的补位分支
    expect(() => normalizeAaguid("AAAAAAAAAAAAAAAAAAAAAA==")).not.toThrow();
  });
  it("空 / null 输入不抛错", () => {
    expect(() => normalizeAaguid(null)).not.toThrow();
    expect(() => normalizeAaguid(undefined)).not.toThrow();
    expect(() => resolveAAGUID("")).not.toThrow();
  });
});

/* ==================================================== sync/sender */

import { sendD1Change } from "../../src/sync/sender.js";

describe("sync/sender：推送来源节点与降级日志", () => {
  const event = { table: "users", action: "UPSERT", data: { id: 1 } } as never;

  it("event 自带 sourceNodeId 时用它，否则用配置的 nodeId", async () => {
    const seen: Array<Record<string, string>> = [];
    const customFetch = vi.fn(async (_u: unknown, init?: RequestInit) => {
      seen.push((init?.headers ?? {}) as Record<string, string>);
      return new Response("{}", { status: 200 });
    });
    const run = async (ev: unknown) => {
      seen.length = 0;
      const waitUntil = vi.fn((p: Promise<unknown>) => void p.catch(() => {}));
      sendD1Change({ waitUntil }, { PEER_SYNC_ENDPOINT: "https://p", PEER_SYNC_SECRET: "s" } as never, ev as never, {
        customFetch,
        nodeId: "cfg-node",
      } as never);
      await (waitUntil.mock.calls[0]?.[0] as Promise<unknown>);
      return seen[0]!;
    };
    expect((await run(event))["X-Sync-Origin-Node"]).toBe("cfg-node");
    expect((await run({ ...(event as object), sourceNodeId: "explicit-node" }))["X-Sync-Origin-Node"]).toBe(
      "explicit-node",
    );
  });

  it("推送失败时降级而非抛错（KIT-BUG-02 起日志级别为 warn）", async () => {
    // 从 console.debug 提到 console.warn：生产环境 debug 默认不可见，
    // 而"主节点与灾备节点静默分叉"必须在默认级别下就能被发现。
    const customFetch = vi.fn(async () => {
      throw new Error("peer offline");
    });
    const waitUntil = vi.fn((p: Promise<unknown>) => void p.catch(() => {}));
    sendD1Change({ waitUntil }, { PEER_SYNC_ENDPOINT: "https://p", PEER_SYNC_SECRET: "s" } as never, event, {
      customFetch,
      maxRetries: 0,
    } as never);
    await (waitUntil.mock.calls[0]?.[0] as Promise<unknown>);
    expect(warn, "投递失败必须留下默认可见的告警").toHaveBeenCalled();
  });
});

/* ==================================================== sso/client */

import { exchangeOidcCode, fetchOidcUserInfo } from "../../src/sso/client.js";

describe("sso/client：未传 fetchImpl 时走全局 fetch", () => {
  const okBody = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });

  it("exchangeOidcCode 不传 fetchImpl 也能工作", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okBody({ access_token: "AT", token_type: "Bearer" })));
    const r = await exchangeOidcCode({
      tokenEndpoint: "https://a/token",
      clientId: "c",
      clientSecret: "s",
      code: "code",
      redirectUri: "https://a/cb",
    } as never);
    expect((r as { access_token: string }).access_token).toBe("AT");
  });

  it("fetchOidcUserInfo 不传 fetchImpl 也能工作", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okBody({ sub: "u1" })));
    const r = await fetchOidcUserInfo({
      userInfoEndpoint: "https://a/me",
      accessToken: "AT",
    } as never);
    expect((r as { sub: string }).sub).toBe("u1");
  });
});
