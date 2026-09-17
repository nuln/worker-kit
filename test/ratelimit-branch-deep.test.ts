import { describe, it, expect, vi } from "vitest";
import {
  RateLimiterDO,
  RateLimitService,
  applyRateLimitHeaders,
  rateLimitMiddleware,
} from "../src/ratelimit/index.js";

describe("RateLimit Module - Deep Branch & DO Lifecycle Coverage", () => {
  it("covers RateLimiterDO alarm cleanup and fetch routing", async () => {
    const limiterDO = new RateLimiterDO({}, {});

    // Consume once
    await limiterDO.consume("temp:key", 5, 1);

    // Run alarm
    await limiterDO.alarm();

    // fetch POST /consume
    const validReq = new Request("https://ratelimiter/consume", {
      method: "POST",
      body: JSON.stringify({ key: "usr:123", limit: 5, windowSec: 30 }),
    });
    const validRes = await limiterDO.fetch(validReq);
    expect(validRes.status).toBe(200);
    const body = (await validRes.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.remaining).toBe(4);

    // fetch non-consume route (404)
    const notFoundReq = new Request("https://ratelimiter/other", { method: "POST" });
    const notFoundRes = await limiterDO.fetch(notFoundReq);
    expect(notFoundRes.status).toBe(404);
  });

  it("covers applyRateLimitHeaders with all optional fields and Retry-After", () => {
    const headers = new Headers();
    applyRateLimitHeaders(headers, {
      ok: false,
      limit: 100,
      remaining: 0,
      resetSeconds: 45,
      retryAfter: 45,
    });
    expect(headers.get("RateLimit-Limit")).toBe("100");
    expect(headers.get("RateLimit-Remaining")).toBe("0");
    expect(headers.get("RateLimit-Reset")).toBe("45");
    expect(headers.get("Retry-After")).toBe("45");
  });

  it("covers RateLimitService DO fetch path and memory fallback", async () => {
    // 1. DO Namespace with fetch stub
    const mockDONamespace = {
      idFromName: () => ({}),
      get: () => ({
        async fetch() {
          return new Response(JSON.stringify({ ok: true, limit: 10, remaining: 9, resetSeconds: 60 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      }),
    };

    const serviceWithDoFetch = new RateLimitService(undefined, mockDONamespace as any);
    const res1 = await serviceWithDoFetch.consume("ip:1.1.1.1", 10, 60);
    expect(res1.ok).toBe(true);
    expect(res1.remaining).toBe(9);

    // 2. Memory / Stateless fallback (no D1, no DO)
    const memoryService = new RateLimitService(undefined, undefined);
    const memRes = await memoryService.consume("ip:2.2.2.2", 20, 60);
    expect(memRes.ok).toBe(true);
    expect(memRes.remaining).toBe(19);
  });

  it("covers rateLimitMiddleware with custom key generator and 429 response", async () => {
    let callCount = 0;
    const mockService = {
      async consume(key: string, limit: number, windowSec: number) {
        callCount++;
        if (callCount > 1) {
          return { ok: false, limit: 1, remaining: 0, resetSeconds: 30, retryAfter: 30 };
        }
        return { ok: true, limit: 1, remaining: 0, resetSeconds: 30 };
      },
    };

    const mw = rateLimitMiddleware({
      limit: 1,
      windowSec: 30,
      getService: () => mockService as any,
      keyGenerator: () => "custom_client_key",
    });

    const resHeaders = new Headers();
    const c: any = {
      req: { header: (k: string) => "192.168.1.1" },
      res: { headers: resHeaders },
      env: {},
    };

    // First call: passes
    let downstreamCalled = false;
    await mw(c, async () => {
      downstreamCalled = true;
    });
    expect(downstreamCalled).toBe(true);

    // Second call: blocked with 429 Response
    const blockRes = await mw(c, async () => {});
    expect(blockRes).toBeInstanceOf(Response);
    expect(blockRes?.status).toBe(429);
    const blockBody = (await blockRes?.json()) as any;
    expect(blockBody.code).toBe("ERR_RATE_LIMITED");
  });
});
