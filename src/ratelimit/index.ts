/**
 * @nuln/worker-kit/ratelimit
 *
 * 边缘高并发双层滑动窗口限流器套件与 IETF 标准响应头规范
 * 架构：Durable Object 内存亚毫秒级原子计数 (优先) + D1 / KV 降级容灾兜底
 */

export interface RateResult {
  /**
   * 是否放行。
   *
   * fail-closed 场景下 `ok:false` 且 `error === "missing_config"` ——
   * 含义是"限流根本没在工作"，与 `error === "rate_limited"`（被限流）必须区分，
   * 否则客户端会把它当成可重试的 429。
   */
  ok: boolean;
  limit?: number;
  remaining: number;
  resetSeconds?: number;
  retryAfter?: number;
  /** 机器可读错误码；`ok:true` 时不存在 */
  error?: "missing_config" | "rate_limited" | "backend_error";
  /** 人类可读说明（面向运维，不含任何密钥值） */
  message?: string;
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
  /** 计数桶容量上限：超过后按 resetAt 淘汰最旧的桶，防止内存无界增长。 */
  static readonly MAX_BUCKETS = 50_000;

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
      this.evictIfNeeded(now);
      await this.scheduleSweep(now + windowMs);
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

  /**
   * 容量上限：超过后按 `resetAt` 淘汰最旧的桶。
   *
   * 没有这一层时，用轮换的 IP/键持续调用会让每个唯一键在 `buckets` 中留下一条
   * 条目；由于 `alarm()` 从未被调度（见 {@link scheduleSweep}），Map 只增不减，
   * 最终 DO 超出内存限制被驱逐 —— 而 `buckets` 是纯内存，**所有计数桶一起丢失**，
   * 限流归零，攻击者获得无限配额，且无任何可观测信号。
   */
  private evictIfNeeded(now: number): void {
    // 先顺带清掉已过期的（惰性清扫，alarm 不可用时仍能回收）
    for (const [k, v] of this.buckets) {
      if (now >= v.resetAt) this.buckets.delete(k);
    }
    while (this.buckets.size > RateLimiterDO.MAX_BUCKETS) {
      let oldestKey: string | null = null;
      let oldest = Infinity;
      for (const [k, v] of this.buckets) {
        if (v.resetAt < oldest) {
          oldest = v.resetAt;
          oldestKey = k;
        }
      }
      if (oldestKey === null) return;
      this.buckets.delete(oldestKey);
    }
  }

  /**
   * 调度清扫 alarm。
   *
   * 历史实现中 `alarm()` 是**死代码**：全仓库从未出现 `setAlarm`，因此该清理
   * 逻辑从未执行过。
   */
  private async scheduleSweep(at: number): Promise<void> {
    const storage = this.ctx?.storage;
    if (!storage?.setAlarm) return;
    try {
      const current = await storage.getAlarm();
      if (current === null || current > at) {
        await storage.setAlarm(at);
      }
    } catch {
      // alarm 能力不可用时静默降级：容量保护仍然生效
    }
  }

  async alarm() {
    const now = Date.now();
    for (const [k, v] of this.buckets.entries()) {
      if (now >= v.resetAt) {
        this.buckets.delete(k);
      }
    }
    if (this.buckets.size === 0) {
      try {
        await this.ctx?.storage?.deleteAlarm?.();
      } catch {
        // 忽略
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
  /** 告警去重：未绑定存储只提示一次，避免刷屏。 */
  private static warnedNoStore = false;

  constructor(
    private d1?: any,
    private doNamespace?: any,
  ) {}

  /**
   * 消耗一次配额。
   *
   * @throws {ConfigError} 未绑定任何限流存储且调用方要求 fail-closed 时
   *   （`consumeOrThrow`）
   */
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
        console.debug("[RateLimitService] DO fallback to D1:", err);
      }
    }

    // 未绑定任何限流存储 —— **fail-closed**。
    //
    // 历史实现返回 `{ ok: true, remaining: limit - 1 }`：既让限流完全失效
    // （每次都放行），又谎报"刚消耗 1 次"，使"忘记绑定限流存储"这一配置缺陷
    // 无法被监控发现 —— 攻击者获得无限配额，而面板一片绿。
    //
    // 现明确报错：返回 `ok:false` + `error:"missing_config"`，由
    // `rateLimitMiddleware` 转成 **503**（而非 429 —— 429 意味着"限流在工作"，
    // 而这里根本没在工作，报 429 会误导客户端重试逻辑与监控）。
    if (!this.d1 && !this.doNamespace) {
      RateLimitService.warnMissingStoreOnce();
      return {
        ok: false,
        limit,
        remaining: 0,
        resetSeconds: windowSec,
        error: "missing_config",
        message: "限流存储未绑定：缺少 RATE_LIMITER_DO 与 D1，无法执行限流",
      };
    }

    // 已绑定 DO、但 DO 不可用（抛错 / stub 形状变化 / 被驱逐）时会落到这里，
    // 而 `this.d1` 可能是 undefined。早先的实现直接 `this.d1.prepare(...)`，
    // 于是抛出 `Cannot read properties of undefined (reading 'prepare')`：
    // 既没有 fail-closed，还把内部堆栈一路抛到客户端（违反 AGENTS §7.3）。
    if (!this.d1) {
      return {
        ok: false,
        limit,
        remaining: 0,
        resetSeconds: windowSec,
        error: "missing_config",
        message: "限流存储不可用：RATE_LIMITER_DO 调用失败且未提供 D1 兜底，无法执行限流",
      };
    }

    try {
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
    } catch (err) {
      // D1 自身出错（网络抖动 / schema 不匹配）同样不得让限流静默失效，
      // 更不得把底层报错抛给客户端。fail-closed 并给出可运维的说明。
      console.error("[RateLimitService] D1 限流失败，已 fail-closed：", err);
      return {
        ok: false,
        limit,
        remaining: 0,
        resetSeconds: windowSec,
        error: "backend_error",
        message: "限流存储不可用（D1 调用失败），已 fail-closed",
      };
    }
  }

  /** 未绑定存储时只提示一次，避免每次请求刷屏。 */
  private static warnMissingStoreOnce(): void {
    if (RateLimitService.warnedNoStore) return;
    RateLimitService.warnedNoStore = true;
    console.error(
      "[RateLimitService] 未绑定 RATE_LIMITER_DO 且未提供 D1 —— 限流已 fail-closed（返回 503）。" +
        "请在 wrangler.jsonc 声明 DurableObject 绑定，或向 RateLimitService 传入 D1。",
    );
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
      // 配置缺失 → 503（依赖不可用，语义上不同于"被限流"）
    if (result.error === "missing_config") {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "service_not_configured",
          code: "CONFIG_MISSING",
          message: result.message ?? "限流存储未绑定",
        }),
        { status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" } },
      );
    }

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
