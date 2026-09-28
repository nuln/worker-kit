/**
 * 各通知驱动的平台长度防护（KIT-BUG-01）
 *
 * ## 这组测试在防什么
 *
 * 超长消息在平台上表现为**静默失败**：
 *
 * | 平台 | 失败形态 | 可见性 |
 * | --- | --- | --- |
 * | Telegram | HTTP 400 `message is too long` | 驱动能看见状态码 |
 * | 企业微信 | HTTP 400 | 驱动能看见状态码 |
 * | Bark | APNs 静默丢包 | **完全不可见**，连回调都没有 |
 * | 飞书 | `code: 19021` | 驱动能看见 |
 *
 * 而触发条件恰恰是最高价值的告警：几十行异常堆栈、批量操作清单。
 * 所以这里不只测"有截断"，还测"截断后的东西平台真的能收"——
 * 即长度合规、UTF-8 合法、标签配对。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { sendTelegram } from "../../src/notify/drivers/telegram.js";
import { sendWeCom } from "../../src/notify/drivers/wecom.js";
import { sendBark } from "../../src/notify/drivers/bark.js";
import { sendFeishu } from "../../src/notify/drivers/feishu.js";
import { PLATFORM_LIMITS } from "../../src/notify/security.js";

const enc = new TextEncoder();
const byteLen = (s: string) => enc.encode(s).length;

/** 从驱动实际发出的请求体里取出被平台计费的那个字段 */
const sentBody = (): Record<string, any> => {
  const fn = vi.mocked(fetch);
  const init = fn.mock.calls[0]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body ?? "{}"));
};

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  warn.mockRestore();
});

/**
 * 各平台的成功响应体形**不同**。用同一个通用 mock 会让"投递成功"判定失败，
 * 于是把"截断是否生效"和"响应是否被识别"两件事搅在一起 ——
 * 断言红了你不知道该改哪个。
 *
 *   - Telegram：`{ ok: true, result: {...} }`
 *   - WeCom：  `{ errcode: 0 }`
 *   - Bark：   `{ code: 200 }`
 *   - Feishu： `{ code: 0 }`
 */
const okTelegram = () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
const okWeCom = () => new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200 });
const okBark = () => new Response(JSON.stringify({ code: 200, message: "success" }), { status: 200 });
const okFeishu = () => new Response(JSON.stringify({ code: 0, msg: "success" }), { status: 200 });

/** 超长载荷：模拟 200 行异常堆栈 */
const huge = (lines = 200) => ({
  title: "生产环境告警",
  message: Array.from({ length: lines }, (_, i) => `at handler${i} (/app/src/mod${i}.ts:${i}:1)`).join("\n"),
  level: "alert" as const,
  event: "error",
});

describe("Telegram：text 上限 4096 字符", () => {
  const cfg = { botToken: "T", chatId: "1" } as never;

  it("超长正文被截断到 4096 字符以内", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okTelegram()));
    const r = await sendTelegram(cfg, huge(2000) as never);
    expect(r.ok).toBe(true);
    const text = String(sentBody().text);
    expect([...text].length).toBeLessThanOrEqual(PLATFORM_LIMITS.telegram.maxLength);
  });

  it("截断后带有明确标记（接收方知道内容不全）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okTelegram()));
    await sendTelegram(cfg, huge(2000) as never);
    expect(String(sentBody().text)).toContain("Content truncated due to platform size limit");
  });

  it("截断后 HTML 标签仍然配对（否则 Telegram 直接 400）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okTelegram()));
    await sendTelegram(cfg, huge(2000) as never);
    const text = String(sentBody().text);
    const opens = (text.match(/<b>/g) ?? []).length;
    const closes = (text.match(/<\/b>/g) ?? []).length;
    expect(opens, "开闭标签数量必须一致").toBe(closes);
  });

  it("短消息不被截断（不做多余改动）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okTelegram()));
    await sendTelegram(cfg, { title: "短", message: "正常", level: "info", event: "x" } as never);
    expect(String(sentBody().text)).not.toContain("Content truncated due to platform size limit");
  });

  it("标题本身超长时也收敛", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okTelegram()));
    await sendTelegram(cfg, { title: "标".repeat(9000), message: "m", level: "info", event: "x" } as never);
    expect([...String(sentBody().text)].length).toBeLessThanOrEqual(PLATFORM_LIMITS.telegram.maxLength);
  });
});

describe("WeCom：markdown.content 上限 4096 字节", () => {
  const cfg = { webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=K" } as never;

  it("超长正文按**字节**收敛到 4096 以内", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okWeCom()));
    const r = await sendWeCom(cfg, huge(2000) as never);
    expect(r.ok).toBe(true);
    const content = String(sentBody().markdown?.content ?? "");
    expect(byteLen(content), "按字节计量（中文一字 3 字节）").toBeLessThanOrEqual(
      PLATFORM_LIMITS.wecom.maxLength,
    );
  });

  it("截断不产生非法 UTF-8（否则签名与解析都会失败）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okWeCom()));
    await sendWeCom(cfg, huge(2000) as never);
    const content = String(sentBody().markdown?.content ?? "");
    expect(content).not.toContain("\uFFFD");
    expect(() => new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(enc.encode(content))).not.toThrow();
  });

  it("截断后 <font> 标签闭合（WeCom 对标签不配对极其敏感）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okWeCom()));
    await sendWeCom(cfg, huge(2000) as never);
    const content = String(sentBody().markdown?.content ?? "");
    expect((content.match(/<font/g) ?? []).length).toBe((content.match(/<\/font>/g) ?? []).length);
  });

  it("纯中文告警：按字符看没超限，按字节已超 —— 必须拦住", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okWeCom()));
    // 2000 个中文字 = 6000 字节 > 4096，但只有 2000 字符 < 4096
    const payload = { title: "告警", message: "中".repeat(2000), level: "warning" as const, event: "e" };
    await sendWeCom(cfg, payload as never);
    const content = String(sentBody().markdown?.content ?? "");
    expect(byteLen(content)).toBeLessThanOrEqual(PLATFORM_LIMITS.wecom.maxLength);
    expect(content).toContain("Content truncated due to platform size limit");
  });

  it("短消息不截断", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okWeCom()));
    await sendWeCom(cfg, { title: "短", message: "正常", level: "info", event: "x" } as never);
    expect(String(sentBody().markdown?.content ?? "")).not.toContain("Content truncated due to platform size limit");
  });
});

describe("Bark：整个 payload 约 4KB（APNs 静默丢包）", () => {
  const cfg = { server: "https://api.day.app", deviceKey: "K" } as never;

  it("超长正文被收敛", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okBark()));
    const r = await sendBark(cfg, huge(2000) as never);
    expect(r.ok).toBe(true);
    expect(byteLen(String(sentBody().body))).toBeLessThanOrEqual(PLATFORM_LIMITS.bark.maxLength);
  });

  it("标题与正文都收敛（早期版本只截正文，标题超长仍会顶爆总包）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okBark()));
    await sendBark(cfg, { title: "标".repeat(9000), message: "内".repeat(9000), level: "info", event: "x" } as never);
    const b = sentBody();
    expect(byteLen(String(b.title)), "标题").toBeLessThanOrEqual(PLATFORM_LIMITS.bark.maxLength);
    expect(byteLen(String(b.body)), "正文").toBeLessThanOrEqual(PLATFORM_LIMITS.bark.maxLength);
  });

  it("序列化后的整个 payload 仍在 4KB 余量内", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okBark()));
    await sendBark(cfg, huge(2000) as never);
    const raw = String((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body ?? "");
    expect(byteLen(raw), "Bark 的限制作用于整个 payload").toBeLessThan(PLATFORM_LIMITS.bark.maxLength + 512);
  });

  it("level 映射不受截断影响", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okBark()));
    await sendBark(cfg, { title: "t", message: "m", level: "alert", event: "x" } as never);
    expect(sentBody().level).toBe("critical");
  });

  it("短消息不截断", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okBark()));
    await sendBark(cfg, { title: "短", message: "正常", level: "info", event: "x" } as never);
    expect(String(sentBody().body)).not.toContain("Content truncated due to platform size limit");
  });
});

describe("Feishu：卡片内容 20000 字符", () => {
  const cfg = { webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/abcdefghijklmnopqrstuvwxyz" } as never;

  it("超长内容在**字段层面**收敛，JSON 保持合法", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okFeishu()));
    const r = await sendFeishu(cfg, huge(20000) as never);
    expect(r.ok).toBe(true);
    // 能被 JSON.parse 说明结构没被截坏 —— 这是卡片类载荷的关键断言
    const raw = String((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body ?? "");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("卡片各文本字段均不超过上限", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okFeishu()));
    await sendFeishu(cfg, huge(20000) as never);
    const card = sentBody();
    const texts: string[] = [];
    const collect = (v: unknown): void => {
      if (typeof v === "string") texts.push(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === "object") Object.values(v).forEach(collect);
    };
    collect(card);
    for (const t of texts) {
      expect([...t].length, t.slice(0, 40)).toBeLessThanOrEqual(PLATFORM_LIMITS.feishu.maxLength);
    }
  });

  it("带签名时 sign/timestamp 仍正确附加（截断不能破坏签名流程）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okFeishu()));
    await sendFeishu({ ...(cfg as object), secret: "S" } as never, huge(500) as never);
    const card = sentBody();
    expect(card.sign).toBeTruthy();
    expect(card.timestamp).toBeTruthy();
  });

  it("短消息不截断", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okFeishu()));
    await sendFeishu(cfg, { title: "短", message: "正常", level: "info", event: "x" } as never);
    expect(JSON.stringify(sentBody())).not.toContain("Content truncated due to platform size limit");
  });
});

describe("截断标记本身可读", () => {
  it("截断标记用报告指定的字面量（英文，国际团队转发时同样可读）", async () => {
    // 审计报告 BUG-01 条款 3 明确指定了这段字面量，是验收标准。
    // 接收方据此判断"内容不全"，而不是误以为这就是全部。
    vi.stubGlobal("fetch", vi.fn(async () => okTelegram()));
    await sendTelegram({ botToken: "T", chatId: "1" } as never, huge(2000) as never);
    expect(String(sentBody().text)).toContain(
      "[Content truncated due to platform size limit]",
    );
  });

  it("Bark 用同一标记的紧凑形式（4KB 预算下每字节都要算）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okBark()));
    await sendBark({ server: "https://api.day.app", deviceKey: "K" } as never, huge(2000) as never);
    expect(String(sentBody().body)).toMatch(/truncated/);
  });
});


describe("截断标记字面量与源码一致（防否定断言假绿）", () => {
  const MARK = "Content truncated due to platform size limit";

  it("四个驱动的源码里都真的带上了该标记", () => {
    // 否则上面的 `not.toContain(MARK)` 全部恒真 —— 断言看着在测"不截断"，
    // 实际什么都没测。本轮就踩过：标记从中文改成英文后，两条否定断言
    // 悄无声息地变成了恒真。
    for (const f of ["telegram", "wecom", "bark", "feishu"]) {
      const src = readFileSync(`src/notify/drivers/${f}.ts`, "utf8");
      expect(src, `${f} 源码里应含截断标记`).toContain(MARK);
    }
  });

  it("确实发生了截断时，标记出现在正文里（正向对照）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okTelegram()));
    await sendTelegram({ botToken: "T", chatId: "1" } as never, huge(2000) as never);
    expect(String(sentBody().text)).toContain(MARK);
  });
});
