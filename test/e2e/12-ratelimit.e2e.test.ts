import { describe, it, expect, vi } from "vitest";
import { RateLimiterDO, RateLimitService } from "../../src/ratelimit/index.js";

describe("[E2E Example] 12 - High-Throughput Sliding Window Rate Limiting & DO/D1 Fallback", () => {
  it("orchestrates sliding window consumption, 429 quota exhaustion, and D1 fallback degradation", async () => {
    // 1. Direct In-Memory RateLimiterDO sliding window
    const limiterDO = new RateLimiterDO({}, {});

    // Limit: 3 requests per 60 seconds
    const r1 = await limiterDO.consume("ip:1.1.1.1", 3, 60);
    expect(r1.ok).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = await limiterDO.consume("ip:1.1.1.1", 3, 60);
    expect(r2.ok).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = await limiterDO.consume("ip:1.1.1.1", 3, 60);
    expect(r3.ok).toBe(true);
    expect(r3.remaining).toBe(0);

    // 4th request within window -> Blocked
    const r4 = await limiterDO.consume("ip:1.1.1.1", 3, 60);
    expect(r4.ok).toBe(false);
    expect(r4.remaining).toBe(0);

    // 2. High-Level RateLimitService with D1 fallback
    let currentCount = 0;
    const mockD1 = {
      prepare(sql: string) {
        return {
          bind(...params: any[]) {
            return {
              async first<T = any>(colName?: string): Promise<T | null> {
                currentCount++;
                return (colName === "count" ? currentCount : { count: currentCount }) as any;
              },
              async run() {
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    };

    const service = new RateLimitService(mockD1 as any);


    // Consuming via D1 fallback when DO is omitted
    const d1Res1 = await service.consume("client_app:001", 2, 60);
    expect(d1Res1.ok).toBe(true);
    expect(d1Res1.remaining).toBe(1);

    const d1Res2 = await service.consume("client_app:001", 2, 60);
    expect(d1Res2.ok).toBe(true);
    expect(d1Res2.remaining).toBe(0);

    const d1Res3 = await service.consume("client_app:001", 2, 60);
    expect(d1Res3.ok).toBe(false);
  });
});
