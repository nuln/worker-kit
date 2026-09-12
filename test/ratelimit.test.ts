import { describe, it, expect } from "vitest";
import {
  RateLimiterDO,
  RateLimitService,
} from "../src/ratelimit/index.js";

describe("@nuln/worker-kit/ratelimit", () => {
  it("RateLimiterDO: 内存窗口计数与超额拦截", async () => {
    const limiter = new RateLimiterDO({}, {});
    const key = "user_123";
    const limit = 3;
    const windowSec = 1;

    const r1 = await limiter.consume(key, limit, windowSec);
    expect(r1.ok).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = await limiter.consume(key, limit, windowSec);
    expect(r2.ok).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = await limiter.consume(key, limit, windowSec);
    expect(r3.ok).toBe(true);
    expect(r3.remaining).toBe(0);

    // 第 4 次应超限
    const r4 = await limiter.consume(key, limit, windowSec);
    expect(r4.ok).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.retryAfter).toBeGreaterThanOrEqual(1);

    // 模拟 fetch 接口调用
    const req = new Request("https://ratelimiter/consume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "other_user", limit: 5, windowSec: 10 }),
    });
    const res = await limiter.fetch(req);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.ok).toBe(true);
    expect(json.remaining).toBe(4);
  });

  it("RateLimitService: DO 代理模式优先调用", async () => {
    const mockDOStub = {
      consume: async (_k: string, limit: number, _w: number) => ({
        ok: true,
        remaining: limit - 1,
      }),
    };
    const mockDONamespace = {
      idFromName: () => "mock-id",
      get: () => mockDOStub,
    };

    const service = new RateLimitService(undefined, mockDONamespace);
    const result = await service.consume("ip_1.2.3.4", 10, 60);
    expect(result.ok).toBe(true);
    expect(result.remaining).toBe(9);
  });
});
