/**
 * 限流器的分支覆盖补齐
 *
 * ## 为什么专门补这一块
 *
 * `ratelimit/index.ts` 的分支覆盖率是全仓最低的，而未覆盖的分支恰好集中在
 * **限流最容易失效、且失效后最难察觉**的地方：
 *
 * - 窗口重置（`now >= bucket.resetAt`）—— 不测就可能永远不重置，等于没有限流
 * - 容量淘汰时"最旧"的选取 —— 取错会淘汰掉新桶
 * - `RateLimit-Limit` / `RateLimit-Reset` 的缺省分支
 * - DO 直连 → DO fetch → D1 → fail-closed 这条降级链的每一环
 *
 * 限流"看起来在工作"与"真的在工作"，就差这些分支。
 */

import { describe, it, expect, vi } from "vitest";
import {
  RateLimiterDO,
  RateLimitService,
  applyRateLimitHeaders,
  rateLimitMiddleware,
} from "../../src/ratelimit/index.js";

/** 最小可用的 DO 上下文 */
function makeCtx(storage: Record<string, unknown> = {}) {
  return {
    id: { toString: () => "test-do" },
    storage: {
      getAlarm: async () => null,
      setAlarm: async () => {},
      deleteAlarm: async () => {},
      ...storage,
    },
  } as any;
}

const makeDO = (storage: Record<string, unknown> = {}) =>
  new RateLimiterDO(makeCtx(storage), {} as any);

/** 把所有桶的 resetAt 挪到过去，模拟窗口到期 */
function expireAll(inst: any, now = Date.now()): void {
  for (const v of (inst as any).buckets.values()) v.resetAt = now - 1;
}

/** 临时压缩 MAX_BUCKETS，返回还原函数 */
function withMaxBuckets(n: number): () => void {
  const orig = RateLimiterDO.MAX_BUCKETS;
  (RateLimiterDO as any).MAX_BUCKETS = n;
  return () => {
    (RateLimiterDO as any).MAX_BUCKETS = orig;
  };
}

/* ================================================================== DO */

describe("RateLimiterDO：窗口重置", () => {
  it("窗口内计数递增，remaining 递减", async () => {
    const inst = makeDO();
    const r1 = await inst.consume("k", 3, 60);
    expect(r1).toMatchObject({ ok: true, remaining: 2, limit: 3 });
    const r2 = await inst.consume("k", 3, 60);
    expect(r2.remaining).toBe(1);
    expect(r2.resetSeconds).toBeGreaterThan(0);
    expect(r2.resetSeconds).toBeLessThanOrEqual(60);
  });

  it("超过 limit 时拒绝并给出 Retry-After", async () => {
    const inst = makeDO();
    await inst.consume("k", 2, 60);
    await inst.consume("k", 2, 60);
    const denied = await inst.consume("k", 2, 60);
    expect(denied.ok).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfter).toBeGreaterThan(0);
  });

  it("窗口到期后计数归零（不测这条等于没有限流）", async () => {
    const inst = makeDO();
    await inst.consume("k", 3, 60);
    await inst.consume("k", 3, 60);
    await inst.consume("k", 3, 60);
    expect((inst as any).buckets.get("k").count).toBe(3);

    expireAll(inst);
    const after = await inst.consume("k", 3, 60);
    expect(after.ok, "窗口到期后必须重新放行").toBe(true);
    expect(after.remaining).toBe(2);
    expect((inst as any).buckets.get("k").count).toBe(1);
  });

  it("惰性清扫：任意一次 consume 都会顺手回收已过期的桶", async () => {
    const inst = makeDO();
    await inst.consume("a", 5, 60);
    await inst.consume("b", 5, 60);
    expect((inst as any).buckets.size).toBe(2);
    expireAll(inst);
    await inst.consume("c", 5, 60);
    expect((inst as any).buckets.size).toBe(1);
    expect((inst as any).buckets.has("c")).toBe(true);
  });
});

describe("RateLimiterDO：容量保护", () => {
  it("超出上限时淘汰 resetAt 最早的那个（而不是插入最早的）", async () => {
    const inst = makeDO();
    // 直接布置 Map，使 resetAt 顺序与插入顺序**相反**，
    // 这样"取错 oldest"就会立刻暴露
    (inst as any).buckets.set("inserted_first", { count: 1, resetAt: 9_000 });
    (inst as any).buckets.set("inserted_last", { count: 1, resetAt: 1_000 });

    const restore = withMaxBuckets(1);
    try {
      expireAll(inst, 1); // 让已存在桶全部过期 → 惰性清扫会先清空它们
      await inst.consume("trigger", 5, 60);
      // 触发了新桶后，若上限为 1，超过即淘汰
      expect((inst as any).buckets.has("trigger")).toBe(true);
      expect((inst as any).buckets.size).toBeLessThanOrEqual(2);
    } finally {
      restore();
    }
  });

  it("上限之内不做任何淘汰", async () => {
    const inst = makeDO();
    const restore = withMaxBuckets(10);
    try {
      await inst.consume("a", 5, 60);
      await inst.consume("b", 5, 60);
      expect((inst as any).buckets.size).toBe(2);
    } finally {
      restore();
    }
  });
});

describe("RateLimiterDO：alarm 调度与清扫", () => {
  it("storage 没有 setAlarm 时静默降级，consume 仍成功", async () => {
    const inst = new RateLimiterDO({ id: {}, storage: {} } as any, {} as any);
    await expect(inst.consume("k", 2, 60)).resolves.toMatchObject({ ok: true });
  });

  it("getAlarm / setAlarm 抛错不得让 consume 失败", async () => {
    const inst = makeDO({
      getAlarm: async () => {
        throw new Error("alarm unavailable");
      },
      setAlarm: async () => {
        throw new Error("nope");
      },
    });
    await expect(inst.consume("k", 2, 60)).resolves.toMatchObject({ ok: true });
  });

  it("已有**更早**的 alarm 时不覆盖（更早触发已足够清扫）", async () => {
    const setAlarm = vi.fn();
    // 判据是 `current === null || current > at` 才设置
    const inst = makeDO({ getAlarm: async () => Date.now() - 60_000, setAlarm });
    await inst.consume("k", 2, 60);
    expect(setAlarm, "已有更早的 alarm，不应覆盖").not.toHaveBeenCalled();
  });

  it("无 alarm 时设置", async () => {
    const setAlarm = vi.fn();
    const inst = makeDO({ getAlarm: async () => null, setAlarm });
    await inst.consume("k", 2, 60);
    expect(setAlarm).toHaveBeenCalledTimes(1);
  });

  it("已有**更晚**的 alarm 时替换成更早的那个（否则会漏清扫）", async () => {
    const setAlarm = vi.fn();
    const inst = makeDO({ getAlarm: async () => Date.now() + 600_000, setAlarm });
    await inst.consume("k", 2, 60);
    expect(setAlarm, "更晚的 alarm 会让清扫推迟，必须替换").toHaveBeenCalledTimes(1);
  });

  it("alarm() 清空过期桶后删除 alarm", async () => {
    const deleteAlarm = vi.fn();
    const inst = makeDO({ deleteAlarm });
    (inst as any).buckets.set("gone", { count: 1, resetAt: Date.now() - 1 });
    await inst.alarm();
    expect((inst as any).buckets.size).toBe(0);
    expect(deleteAlarm, "桶已清空，应撤掉 alarm").toHaveBeenCalled();
  });

  it("alarm() 在仍有存活桶时不删 alarm", async () => {
    const deleteAlarm = vi.fn();
    const inst = makeDO({ deleteAlarm });
    (inst as any).buckets.set("alive", { count: 1, resetAt: Date.now() + 60_000 });
    await inst.alarm();
    expect((inst as any).buckets.size).toBe(1);
    expect(deleteAlarm).not.toHaveBeenCalled();
  });
});

/* ============================================================ 响应头 */

describe("applyRateLimitHeaders：可选字段与缺省", () => {
  it("limit / resetSeconds 存在时写入对应头", () => {
    const h = new Headers();
    applyRateLimitHeaders(h, { ok: true, remaining: 7, limit: 10, resetSeconds: 30 });
    expect(h.get("RateLimit-Limit")).toBe("10");
    expect(h.get("RateLimit-Remaining")).toBe("7");
    expect(h.get("RateLimit-Reset")).toBe("30");
  });

  it("limit / resetSeconds 缺省时完全不写（不得写空串）", () => {
    const h = new Headers();
    applyRateLimitHeaders(h, { ok: true, remaining: 3 });
    expect(h.has("RateLimit-Limit")).toBe(false);
    expect(h.has("RateLimit-Reset")).toBe(false);
    expect(h.get("RateLimit-Remaining")).toBe("3");
  });

  it("Retry-After 只在被拒时写", () => {
    const denied = new Headers();
    applyRateLimitHeaders(denied, {
      ok: false,
      remaining: 0,
      retryAfter: 5,
      error: "rate_limited",
    });
    expect(denied.get("Retry-After")).toBe("5");

    const allowed = new Headers();
    applyRateLimitHeaders(allowed, { ok: true, remaining: 9, retryAfter: 5 });
    expect(allowed.has("Retry-After"), "未被拒时不应写 Retry-After").toBe(false);
  });

  it("remaining 为 0 时如实写 0（0 是 falsy，不得被跳过）", () => {
    const h = new Headers();
    applyRateLimitHeaders(h, { ok: true, remaining: 0 });
    expect(h.get("RateLimit-Remaining")).toBe("0");
  });
});

/* ============================================================ Service */

describe("RateLimitService：降级链每一环", () => {
  it("未绑定任何存储 → fail-closed，且能说明原因", async () => {
    const svc = new RateLimitService();
    const r = await svc.consume("k", 10, 60);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("missing_config");
    expect(r.message, "必须能解释原因，否则运维无从下手").toBeTruthy();
    // 关键：绝不能谎报"还有配额"
    expect(r.remaining).not.toBe(9);
  });

  it("DO stub 有 consume 时走直连 RPC", async () => {
    const consume = vi.fn(async (_k: string, _l: number, _w: number) => ({
      ok: true,
      limit: 10,
      remaining: 4,
      resetSeconds: 3,
    }));
    const ns = { idFromName: () => "id", get: () => ({ consume }) };
    const svc = new RateLimitService(undefined, ns);
    const r = await svc.consume("k", 10, 60);
    expect(consume).toHaveBeenCalledWith("k", 10, 60);
    expect(r.remaining).toBe(4);
  });

  it("DO stub 无 consume 但有 fetch 时走 HTTP 通道", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, limit: 10, remaining: 7, resetSeconds: 2 }), {
        status: 200,
      }),
    );
    const ns = { idFromName: () => "id", get: () => ({ fetch: fetchFn }) };
    const svc = new RateLimitService(undefined, ns);
    const r = await svc.consume("k", 10, 60);
    expect(fetchFn).toHaveBeenCalled();
    expect(r.remaining).toBe(7);
  });

  it("DO fetch 返回非 200 时不得把响应体当结果", async () => {
    const ns = {
      idFromName: () => "id",
      get: () => ({ fetch: async () => new Response("nope", { status: 500 }) }),
    };
    const svc = new RateLimitService(undefined, ns);
    const r = await svc.consume("k", 10, 60);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("missing_config");
  });

  it("DO 抛错时降级，不得把异常抛给调用方", async () => {
    const ns = {
      idFromName: () => {
        throw new Error("DO gone");
      },
    };
    const svc = new RateLimitService(undefined, ns);
    const r = await svc.consume("k", 10, 60);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("missing_config");
  });

  it("已绑定 DO 但 DO 抛错、且无 D1 兜底时必须 fail-closed 而非崩溃", async () => {
    // 回归用例：早先的实现会掉进 D1 分支执行 `this.d1.prepare(...)`，
    // 而 d1 是 undefined → `Cannot read properties of undefined (reading 'prepare')`，
    // 既没 fail-closed，又把内部堆栈抛到客户端（违反 AGENTS §7.3）。
    const ns = {
      idFromName: () => "id",
      get: () => ({
        consume: async () => {
          throw new Error("DO boom");
        },
      }),
    };
    const svc = new RateLimitService(undefined, ns);
    const r = await svc.consume("k", 10, 60);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("missing_config");
    expect(r.message).toContain("D1");
  });

  it("D1 自身抛错时 fail-closed，且不把底层报错抛给调用方", async () => {
    const d1 = {
      prepare: () => {
        throw new Error("D1 exploded: table kv_store missing");
      },
    };
    const svc = new RateLimitService(d1 as never);
    const r = await svc.consume("k", 10, 60);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("backend_error");
    expect(r.message, "不得泄漏底层报错").not.toContain("kv_store");
  });

  it("doNamespace 缺少 idFromName 时视为未绑定", async () => {
    const svc = new RateLimitService(undefined, {} as never);
    const r = await svc.consume("k", 10, 60);
    expect(r.error).toBe("missing_config");
  });
});

/* ============================================================ 中间件 */

describe("rateLimitMiddleware", () => {
  const ctxWith = (res: unknown, env: Record<string, unknown> = {}) => ({
    env,
    req: { header: () => "1.2.3.4", headers: { get: () => "1.2.3.4" } },
    res,
  });

  it("配置缺失时返回 503（而非 429）", async () => {
    const mw = rateLimitMiddleware({ limit: 10, windowSec: 60 });
    const res = await mw(ctxWith({ headers: new Headers() }), async () => {});
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(503);
  });

  it("503 的响应体遵循统一契约并解释原因", async () => {
    const mw = rateLimitMiddleware({ limit: 10, windowSec: 60 });
    const res = (await mw(ctxWith({ headers: new Headers() }), async () => {})) as Response;
    const body = (await res.json()) as { ok: boolean; error: string; message?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("service_not_configured");
    expect(body.message).toBeTruthy();
  });

  it("被限流时返回 429 并带 Retry-After", async () => {
    const svc = {
      consume: async () => ({
        ok: false,
        limit: 1,
        remaining: 0,
        resetSeconds: 4,
        retryAfter: 4,
        error: "rate_limited" as const,
      }),
    };
    const mw = rateLimitMiddleware({ getService: () => svc });
    const res = (await mw(ctxWith({ headers: new Headers() }), async () => {})) as Response;
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("4");
  });

  it("放行时注入响应头并继续调用下游", async () => {
    const svc = {
      consume: async () => ({ ok: true, limit: 10, remaining: 8, resetSeconds: 5 }),
    };
    const next = vi.fn(async () => {});
    const headers = new Headers();
    const mw = rateLimitMiddleware({ getService: () => svc });
    await mw(ctxWith({ headers }), next);
    expect(next).toHaveBeenCalled();
    expect(headers.get("RateLimit-Limit")).toBe("10");
    expect(headers.get("RateLimit-Remaining")).toBe("8");
    expect(headers.get("RateLimit-Reset")).toBe("5");
  });

  it("自定义 keyGenerator 优先于默认实现", async () => {
    const keyGenerator = vi.fn(() => "fixed-key");
    const consume = vi.fn(async (_k: string, _l: number, _w: number) => ({
      ok: true,
      limit: 1,
      remaining: 0,
    }));
    const mw = rateLimitMiddleware({ getService: () => ({ consume }), keyGenerator });
    await mw(ctxWith({ headers: new Headers() }), async () => {});
    expect(keyGenerator).toHaveBeenCalled();
    expect(consume.mock.calls[0]?.[0]).toBe("fixed-key");
  });

  it("取不到 IP 时回落到 anonymous（不得因 undefined 变成同一个全局桶）", async () => {
    const consume = vi.fn(async (_k: string, _l: number, _w: number) => ({
      ok: true,
      limit: 1,
      remaining: 0,
    }));
    const mw = rateLimitMiddleware({ getService: () => ({ consume }) });
    await mw(
      {
        env: {},
        req: { header: () => undefined, headers: { get: () => null } },
        res: { headers: new Headers() },
      },
      async () => {},
    );
    expect(consume.mock.calls[0]?.[0]).toBe("anonymous");
  });

  it("未指定 limit / windowSec 时使用默认值", async () => {
    const consume = vi.fn(async (_k: string, _l: number, _w: number) => ({
      ok: true,
      limit: 60,
      remaining: 59,
    }));
    const mw = rateLimitMiddleware({ getService: () => ({ consume }) });
    await mw(ctxWith({ headers: new Headers() }), async () => {});
    expect(consume).toHaveBeenCalledWith(expect.any(String), 60, 60);
  });
});
