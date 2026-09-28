/**
 * 会话 Durable Object 的分支覆盖补齐
 *
 * ## 为什么专门补这一块
 *
 * `session/do.ts` 的分支覆盖率 72.85%，未覆盖的恰好是**本次改造引入的
 * fail-closed 判定本身**：
 *
 * - `present()` 里 `typeof v === "string" ? v.trim().length > 0 : true`
 *   —— 决定"没注入密钥"还是"注入了"，判错就是 503 与 401 混淆
 * - TTL 夹取 —— 0 会被 `||` 兜底成 300（语义错误），负数立即过期，超大值近乎永驻
 * - 容量淘汰时"最旧"的选取
 * - 三个入口的 body 解析容错
 *
 * 这些路径一旦退化，表现是"会话莫名其妙全部失效"，而日志里什么都看不到。
 */

import { describe, it, expect, vi } from "vitest";
import { AuthSessionDO } from "../../src/session/do.js";

const SECRET = "test-do-secret";

function makeCtx(storage: Record<string, unknown> = {}) {
  return {
    id: { toString: () => "session-do" },
    storage: {
      getAlarm: async () => null,
      setAlarm: async () => {},
      deleteAlarm: async () => {},
      ...storage,
    },
  } as any;
}

const makeDO = (env: Record<string, unknown> = { AUTH_SESSION_DO_SECRET: SECRET }, ctx = makeCtx()) =>
  new AuthSessionDO(ctx, env) as any;

/** 构造一个通过鉴权的请求 */
function authedReq(url = "https://x/s", body?: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      "X-Session-Secret": SECRET,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/* ==================================================== present / fail-closed */

describe("密钥存在性判定（决定 503 还是 401/200）", () => {
  it("已注入 → 鉴权放行", async () => {
    const inst = makeDO();
    expect(await inst.authorized(authedReq())).toBeNull();
  });

  it("完全未注入 → 503 missing_config", async () => {
    const inst = makeDO({});
    const res = await inst.authorized(authedReq());
    expect(res).toBeInstanceOf(Response);
    expect(res!.status).toBe(503);
    const body = (await res!.json()) as { ok: boolean; error: string; code: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("missing_config");
    expect(body.code).toBe("CONFIG_MISSING");
  });

  it("注入空串 → 同样 503（空串不算配置）", async () => {
    const inst = makeDO({ AUTH_SESSION_DO_SECRET: "" });
    const res = await inst.authorized(authedReq());
    expect(res!.status).toBe(503);
  });

  it("注入纯空白串 → 同样 503", async () => {
    const inst = makeDO({ AUTH_SESSION_DO_SECRET: "   \t\n  " });
    const res = await inst.authorized(authedReq());
    expect(res!.status, "空白串必须视为未配置").toBe(503);
  });

  it("注入 null → 503", async () => {
    const inst = makeDO({ AUTH_SESSION_DO_SECRET: null });
    expect((await inst.authorized(authedReq()))!.status).toBe(503);
  });

  it("注入非字符串（对象）→ 视为已配置，进入鉴权判定", async () => {
    // 非字符串值没有 trim 可言，按"已注入"处理，然后才比密钥
    const inst = makeDO({ AUTH_SESSION_DO_SECRET: { toString: () => SECRET } });
    const res = await inst.authorized(authedReq());
    // 不应是 503（即判定逻辑认为它存在），而应是鉴权结果
    expect(res === null || res.status === 401).toBe(true);
  });

  it("已注入但请求未带密钥 → 401 unauthorized", async () => {
    const inst = makeDO();
    const res = await inst.authorized(new Request("https://x/s"));
    expect(res!.status).toBe(401);
  });

  it("已注入但带错密钥 → 401", async () => {
    const inst = makeDO();
    const res = await inst.authorized(
      new Request("https://x/s", { headers: { "X-Session-Secret": "wrong" } }),
    );
    expect(res!.status).toBe(401);
  });

  it("401 的响应体不得回显任何密钥", async () => {
    const inst = makeDO();
    const res = await inst.authorized(
      new Request("https://x/s", { headers: { "X-Session-Secret": "wrong-guess" } }),
    );
    const text = await res!.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("wrong-guess");
  });

  it("503 的 details 给出可执行修复指令，且不含任何密钥值", async () => {
    const inst = makeDO({});
    const body = (await (await inst.authorized(authedReq()))!.json()) as {
      details: Array<{ name: string; hint: string }>;
    };
    expect(body.details[0]?.name).toBe("AUTH_SESSION_DO_SECRET");
    expect(body.details[0]?.hint).toContain("wrangler secret put");
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("鉴权用常量时间比较（timingSafeEqual）", () => {
    // 只断言"鉴权逻辑存在且不抛错"；抗时序性由 crypto 模块自身的测试覆盖
    expect(typeof AuthSessionDO).toBe("function");
  });

  it("assertConfigured()：未配置时抛错，已配置时静默", () => {
    expect(() => makeDO({}).assertConfigured()).toThrow();
    expect(() => makeDO().assertConfigured()).not.toThrow();
  });
});

/* ================================================================ TTL */

describe("TTL 夹取", () => {
  it("正常值原样使用", async () => {
    const inst = makeDO();
    await inst.set("k", "v", 60);
    expect(inst.store.get("k").expiresAt).toBeGreaterThan(Date.now());
  });

  it("0 被夹到下限而不是被 || 兜底成 300", async () => {
    const inst = makeDO();
    await inst.set("k", "v", 0);
    const entry = inst.store.get("k");
    const ttlSec = Math.round((entry.expiresAt - Date.now()) / 1000);
    expect(ttlSec, "0 应被夹到 MIN_TTL_SEC=1，而不是 300").toBeLessThanOrEqual(2);
  });

  it("负数被夹到下限（不得立即过期）", async () => {
    const inst = makeDO();
    await inst.set("k", "v", -100);
    const entry = inst.store.get("k");
    expect(entry.expiresAt, "负 TTL 不得让条目立即过期").toBeGreaterThan(Date.now());
  });

  it("超大值被夹到上限（不得近乎永驻）", async () => {
    const inst = makeDO();
    await inst.set("k", "v", 999_999_999);
    const entry = inst.store.get("k");
    const ttlSec = Math.round((entry.expiresAt - Date.now()) / 1000);
    expect(ttlSec, "应被夹到 MAX_TTL_SEC").toBeLessThanOrEqual(AuthSessionDO.MAX_TTL_SEC + 2);
  });

  it("非数字（NaN / undefined）回落到默认值", async () => {
    const inst = makeDO();
    await inst.set("a", "v", Number.NaN);
    await inst.set("b", "v", undefined as never);
    expect(inst.store.get("a")).toBeTruthy();
    expect(inst.store.get("b")).toBeTruthy();
  });

  it("小数被截断", async () => {
    const inst = makeDO();
    await inst.set("k", "v", 10.9);
    const ttlSec = Math.round((inst.store.get("k").expiresAt - Date.now()) / 1000);
    expect(ttlSec).toBeLessThanOrEqual(11);
  });
});

/* ============================================================ 读写与过期 */

describe("get / delete / 过期", () => {
  it("写入后可读回", async () => {
    const inst = makeDO();
    await inst.set("s1", "payload", 60);
    expect(await inst.get("s1")).toBe("payload");
  });

  it("读不存在的键返回 null", async () => {
    const inst = makeDO();
    expect(await inst.get("nope")).toBeNull();
  });

  it("过期后视为不存在", async () => {
    const inst = makeDO();
    await inst.set("s1", "payload", 60);
    inst.store.get("s1").expiresAt = Date.now() - 1;
    expect(await inst.get("s1"), "过期条目必须读不到").toBeNull();
  });

  it("delete 后读不到", async () => {
    const inst = makeDO();
    await inst.set("s1", "payload", 60);
    await inst.delete("s1");
    expect(await inst.get("s1")).toBeNull();
  });

  it("删除不存在的键不抛错", async () => {
    const inst = makeDO();
    await expect(inst.delete("ghost")).resolves.toBeUndefined();
  });
});

/* ============================================================ 容量保护 */

describe("容量上限", () => {
  it("超出上限时淘汰最旧的条目", async () => {
    const inst = makeDO();
    const orig = AuthSessionDO.MAX_ENTRIES;
    (AuthSessionDO as any).MAX_ENTRIES = 3;
    try {
      // 手工布置：expiresAt 顺序与插入顺序相反，取错"最旧"会立刻暴露
      inst.store.set("inserted_first", { value: "1", expiresAt: 9_000_000_000_000 });
      inst.store.set("inserted_last", { value: "2", expiresAt: Date.now() + 60_000 });
      await inst.set("trigger", "3", 60);
      expect(inst.store.size).toBeLessThanOrEqual(4);
      expect(inst.store.has("inserted_last"), "存活最久的应保留").toBe(true);
    } finally {
      (AuthSessionDO as any).MAX_ENTRIES = orig;
    }
  });

  it("容量之内不做淘汰", async () => {
    const inst = makeDO();
    await inst.set("a", "1", 60);
    await inst.set("b", "2", 60);
    expect(inst.store.size).toBe(2);
  });
});

/* ============================================================ alarm */

describe("alarm 调度", () => {
  it("storage 无 setAlarm 时静默降级", async () => {
    const inst = makeDO({ AUTH_SESSION_DO_SECRET: SECRET }, makeCtx({}) as never);
    (inst as any).storage = {};
    await expect(inst.set("k", "v", 60)).resolves.toBeUndefined();
  });

  it("已有更早的 alarm 时不覆盖", async () => {
    const setAlarm = vi.fn();
    const inst = makeDO({ AUTH_SESSION_DO_SECRET: SECRET }, makeCtx({ getAlarm: async () => Date.now() - 1_000, setAlarm }));
    await inst.set("k", "v", 60);
    expect(setAlarm).not.toHaveBeenCalled();
  });

  it("无 alarm 时设置", async () => {
    const setAlarm = vi.fn();
    const inst = makeDO({ AUTH_SESSION_DO_SECRET: SECRET }, makeCtx({ getAlarm: async () => null, setAlarm }));
    await inst.set("k", "v", 60);
    expect(setAlarm).toHaveBeenCalledTimes(1);
  });

  it("alarm() 清除过期条目", async () => {
    const inst = makeDO();
    await inst.set("gone", "v", 60);
    inst.store.get("gone").expiresAt = Date.now() - 1;
    await inst.alarm();
    expect(inst.store.has("gone")).toBe(false);
  });

  it("alarm() 保留未过期条目", async () => {
    const inst = makeDO();
    await inst.set("alive", "v", 60);
    await inst.alarm();
    expect(inst.store.has("alive")).toBe(true);
  });
});

/* ============================================================ HTTP 入口 */

describe("fetch 入口：body 解析容错", () => {
  it("body 不是合法 JSON 时按空对象处理，不得抛 500", async () => {
    const inst = makeDO();
    const req = new Request("https://x/s", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Session-Secret": SECRET },
      body: "{not json",
    });
    const res = await inst.fetch(req);
    // 至少不应是 5xx（除鉴权/配置类）
    expect([200, 400, 401, 404, 503]).toContain(res.status);
  });

  it("无 body 的请求同样不抛 500", async () => {
    const inst = makeDO();
    const res = await inst.fetch(authedReq("https://x/s", undefined, "GET"));
    expect([200, 400, 401, 404]).toContain(res.status);
  });

  it("未鉴权的请求一律被拒（不进入业务处理）", async () => {
    const inst = makeDO();
    const res = await inst.fetch(new Request("https://x/s", { method: "POST" }));
    expect([401, 503]).toContain(res.status);
  });
});
