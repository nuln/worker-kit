/**
 * @nuln/worker-kit/ratelimit
 *
 * 边缘高并发双层滑动窗口限流器套件与 IETF 标准响应头规范
 * 架构：Durable Object 内存亚毫秒级原子计数 (优先) + D1 / KV 降级容灾兜底
 */

export interface RateResult {
  ok: boolean;
  limit?: number;
  remaining: number;
  resetSeconds?: number;
  retryAfter?: number;
}

/**
 * 将标准 IETF 限流响应头注入 Headers 对象
 */
export function applyRateLimitHeaders(headers: Headers, result: RateResult): void {
  if (result.limit !== undefined) {
    headers.set("RateLimit-Limit", String(result.limit));
  }
  headers.set("RateLimit-Remaining", String(result.remaining));
  if (result.resetSeconds !== undefined) {
    headers.set("RateLimit-Reset", String(result.resetSeconds));
  }
  if (!result.ok && result.retryAfter !== undefined) {
    headers.set("Retry-After", String(result.retryAfter));
  }
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
      return {
        ok: true,
        limit,
        remaining: Math.max(0, limit - 1),
        resetSeconds: windowSec,
      };
    }

    bucket.count += 1;
    const resetSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

    if (bucket.count > limit) {
      return {
        ok: false,
        limit,
        remaining: 0,
        resetSeconds: resetSec,
        retryAfter: resetSec,
      };
    }

    return {
      ok: true,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      resetSeconds: resetSec,
    };
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
      return { ok: true, limit, remaining: limit - 1, resetSeconds: windowSec };
    }

    const now = Date.now();
    const windowMs = windowSec * 1000;
    const bucketStart = Math.floor(now / windowMs) * windowMs;
    const bucketEnd = bucketStart + windowMs;
    const rlKey = `rl:${bucketStart}:${key}`;
    const resetSec = Math.max(1, Math.ceil((bucketEnd - now) / 1000));

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
        limit,
        remaining: 0,
        resetSeconds: resetSec,
        retryAfter: resetSec,
      };
    }
    return { ok: true, limit, remaining: limit - count, resetSeconds: resetSec };
  }
}

export interface RateLimitMiddlewareOptions {
  limit?: number;
  windowSec?: number;
  keyGenerator?: (c: any) => string;
  getService?: (c: any) => RateLimitService;
}

/**
 * 限流中间件：自动检查限流并注入标准 IETF 响应头 (兼容 Hono)
 */
export function rateLimitMiddleware(options: RateLimitMiddlewareOptions = {}) {
  const limit = options.limit ?? 60;
  const windowSec = options.windowSec ?? 60;
  const keyGen = options.keyGenerator ?? ((c: any) => {
    return (
      (typeof c?.req?.header === "function" ? c.req.header("cf-connecting-ip") : "") ||
      c?.req?.headers?.get?.("cf-connecting-ip") ||
      "anonymous"
    );
  });

  return async (c: any, next: () => Promise<void>): Promise<Response | void> => {
    const service = options.getService
      ? options.getService(c)
      : new RateLimitService((c?.env as any)?.DB, (c?.env as any)?.RATE_LIMITER_DO);

    const key = keyGen(c);
    const result = await service.consume(key, limit, windowSec);

    // 注入标准 IETF 响应头
    if (c.res?.headers && typeof c.res.headers.set === "function") {
      c.res.headers.set("RateLimit-Limit", String(result.limit ?? limit));
      c.res.headers.set("RateLimit-Remaining", String(result.remaining));
      if (result.resetSeconds !== undefined) {
        c.res.headers.set("RateLimit-Reset", String(result.resetSeconds));
      }
    }

    if (!result.ok) {
      const headers: Record<string, string> = {
        "RateLimit-Limit": String(result.limit ?? limit),
        "RateLimit-Remaining": "0",
        "Content-Type": "application/json",
      };
      if (result.resetSeconds !== undefined) {
        headers["RateLimit-Reset"] = String(result.resetSeconds);
      }
      if (result.retryAfter !== undefined) {
        headers["Retry-After"] = String(result.retryAfter);
      }
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Rate limit exceeded. Please try again later.",
          code: "ERR_RATE_LIMITED",
          retryAfter: result.retryAfter,
        }),
        { status: 429, headers }
      );
    }

    await next();
  };
}
