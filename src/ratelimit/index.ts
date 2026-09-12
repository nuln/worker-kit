/**
 * @nuln/worker-kit/ratelimit
 *
 * 边缘高并发双层滑动窗口限流器套件
 * 架构：Durable Object 内存亚毫秒级原子计数 (优先) + D1 / KV 降级容灾兜底
 */

export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfter?: number;
}

let BaseDurableObject: any = class {};
try {
  const cf = await import("cloudflare:workers");
  if (cf?.DurableObject) {
    BaseDurableObject = cf.DurableObject;
  }
} catch {
  // Node / non-workerd fallback
}

/**
 * Cloudflare Durable Object for in-memory, atomic token-bucket / sliding window rate limiting.
 * 完全消除 D1 数据库写入消耗 (0 D1 writes)，提供单线程内存原子性。
 */
export class RateLimiterDO extends (BaseDurableObject as any) {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  ctx: any;
  env: any;

  constructor(ctx: any, env: any) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async consume(key: string, limit: number, windowSec: number): Promise<RateResult> {
    const now = Date.now();
    const windowMs = windowSec * 1000;
    const bucket = this.buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true, remaining: Math.max(0, limit - 1) };
    }

    bucket.count += 1;
    if (bucket.count > limit) {
      return {
        ok: false,
        remaining: 0,
        retryAfter: Math.ceil((bucket.resetAt - now) / 1000),
      };
    }

    return { ok: true, remaining: Math.max(0, limit - bucket.count) };
  }

  async alarm() {
    const now = Date.now();
    for (const [k, v] of this.buckets.entries()) {
      if (now >= v.resetAt) {
        this.buckets.delete(k);
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/consume" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as any;
      const res = await this.consume(
        String(body?.key || ""),
        Number(body?.limit || 10),
        Number(body?.windowSec || 60),
      );
      return new Response(JSON.stringify(res), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Not Found", { status: 404 });
  }
}

/**
 * 固定窗口限流客户端，支持优先打 DO，异常或未配置时回退到 D1 / SQLite kv_store。
 */
export class RateLimitService {
  constructor(
    private d1?: any,
    private doNamespace?: any,
  ) {}

  async consume(
    key: string,
    limit: number,
    windowSec: number,
  ): Promise<RateResult> {
    if (this.doNamespace && typeof this.doNamespace.idFromName === "function") {
      try {
        const id = this.doNamespace.idFromName("global_rate_limiter");
        const stub = this.doNamespace.get(id);
        if (typeof stub.consume === "function") {
          return await stub.consume(key, limit, windowSec);
        }
        if (typeof stub.fetch === "function") {
          const res = await stub.fetch("https://ratelimiter/consume", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key, limit, windowSec }),
          });
          if (res.status === 200) {
            return await res.json();
          }
        }
      } catch (err) {
        console.error("[RateLimitService] DO error, falling back to D1:", err);
      }
    }

    if (!this.d1) {
      // 内存或无状态临时通过
      return { ok: true, remaining: limit - 1 };
    }

    const now = Date.now();
    const windowMs = windowSec * 1000;
    const bucketStart = Math.floor(now / windowMs) * windowMs;
    const bucketEnd = bucketStart + windowMs;
    const rlKey = `rl:${bucketStart}:${key}`;

    const row = await this.d1
      .prepare(
        `INSERT INTO kv_store (key, value, expires_at) VALUES (?, '1', ?)
         ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1
         RETURNING CAST(value AS INTEGER) AS count`,
      )
      .bind(rlKey, bucketEnd)
      .first("count");

    const count = Number(row ?? 0);
    if (count > limit) {
      return {
        ok: false,
        remaining: 0,
        retryAfter: Math.ceil((bucketEnd - now) / 1000),
      };
    }
    return { ok: true, remaining: limit - count };
  }
}
