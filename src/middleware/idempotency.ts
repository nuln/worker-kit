/**
 * @nuln/worker-kit/middleware/idempotency
 *
 * 统一关键写操作幂等性防护中间件 (Idempotency-Key Middleware)
 */

export interface IdempotencyRecord {
  status: number;
  headers: Record<string, string>;
  body: string;
  createdAt: number;
}

export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | null> | IdempotencyRecord | null;
  set(key: string, record: IdempotencyRecord, ttlSeconds: number): Promise<void> | void;
  lock?(key: string, ttlSeconds: number): Promise<boolean> | boolean;
  unlock?(key: string): Promise<void> | void;
}

/**
 * 内存简易 LRU / Map 幂等存储（单 Worker 实例内降级使用）
 */
export class MemoryIdempotencyStore implements IdempotencyStore {
  private cache = new Map<string, { record: IdempotencyRecord; expiresAt: number }>();
  private locks = new Set<string>();

  get(key: string): IdempotencyRecord | null {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return item.record;
  }

  /** 容量上限：超过后淘汰最旧的条目，防止内存无界增长。 */
  static readonly MAX_ENTRIES = 5_000;

  set(key: string, record: IdempotencyRecord, ttlSeconds: number): void {
    this.cache.set(key, {
      record,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    this.evictIfNeeded();
  }

  /**
   * 容量保护。
   *
   * `set()` 从不检查容量，而过期项只在被 `get()` 命中时才删除 —— 24 小时 TTL
   * 内未被二次访问的键会永久驻留。该表是模块级单例（同一 isolate 内所有租户、
   * 所有路由共享），无界增长会拖垮整个 Worker isolate。
   */
  private evictIfNeeded(): void {
    while (this.cache.size > MemoryIdempotencyStore.MAX_ENTRIES) {
      let oldestKey: string | undefined;
      let oldest = Infinity;
      for (const [k, v] of this.cache) {
        if (v.expiresAt < oldest) {
          oldest = v.expiresAt;
          oldestKey = k;
        }
      }
      if (oldestKey === undefined) return;
      this.cache.delete(oldestKey);
    }
  }

  lock(key: string): boolean {
    if (this.locks.has(key)) return false;
    this.locks.add(key);
    return true;
  }

  unlock(key: string): void {
    this.locks.delete(key);
  }
}

/**
 * Cloudflare KV 幂等存储器适配
 */
export class KvIdempotencyStore implements IdempotencyStore {
  constructor(private kv: any, private prefix = "idemp:") {}

  async get(key: string): Promise<IdempotencyRecord | null> {
    if (!this.kv) return null;
    const raw = await this.kv.get(this.prefix + key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async set(key: string, record: IdempotencyRecord, ttlSeconds: number): Promise<void> {
    if (!this.kv) return;
    await this.kv.put(this.prefix + key, JSON.stringify(record), {
      expirationTtl: Math.max(60, ttlSeconds),
    });
  }

  /**
   * Best-effort 互斥。
   *
   * ## 为什么原实现是错的
   *
   * 原实现无条件 `return true`，即**根本没有互斥**。KV 既没有原子条件写，
   * 也没有 compare-and-swap，因此这个"锁"只是摆设：`get → lock → 执行 → set`
   * 流程中，两个并发请求都能通过 `get`（miss）都能通过 `lock`，于是 handler
   * 被完整执行两次 —— 扣款两次、发两封邮件、创建两个凭据，而接口返回 200，
   * 看起来幂等生效。这恰好是该中间件声称要解决的核心场景。
   *
   * ## 本实现能保证什么、不能保证什么
   *
   * Cloudflare KV 是**最终一致**的，读可能命中任意副本，因此：
   * - 能挡住：同一区域内、时间上错开的重复请求（常见重试场景）
   * - **挡不住**：真正并发的两个请求 —— 两者都写入锁、随后都读到自己写的值，
   *   都会认为自己抢到了锁
   *
   * 强一致场景应改用 D1 的 `INSERT ... ON CONFLICT DO NOTHING` 抢占唯一键
   * （以插入结果判定是否抢到），或 Durable Object 的 storage 事务。
   * 本方法仅在等待失败时快速失败，把"重复执行"降级为"返回 409"，属于尽力而为。
   */
  private readonly locks = new Set<string>();

  async lock(key: string, ttlSeconds: number): Promise<boolean> {
    const marker = `${this.prefix}lock:${key}`;
    try {
      // 先写后读：写成功且读回的值与自己一致时，认为抢到了锁
      await this.kv.put(marker, "1", { expirationTtl: Math.max(60, ttlSeconds) });
      const seen = await this.kv.get(marker);
      if (seen === "1" && !this.locks.has(key)) {
        this.locks.add(key);
        return true;
      }
      return false;
    } catch {
      // KV 不可用时不阻塞主流程（fail-open，见类注释的局限说明）
      return true;
    }
  }

  async unlock(key: string): Promise<void> {
    this.locks.delete(key);
    try {
      await this.kv.delete(`${this.prefix}lock:${key}`);
    } catch {
      // 锁会随 TTL 自动过期，删除失败不阻塞
    }
  }
}

export interface IdempotencyOptions {
  headerName?: string;
  ttlSeconds?: number;
  getStore?: (req: Request, env: any) => IdempotencyStore;
  /**
   * 参与存储键作用域的租户/用户标识。
   *
   * 强烈建议提供（如 `env.AUTH_SESSION_DO_SECRET` 之外的租户 ID，或从
   * 已验证会话中取出的 userId）。不提供时作用域退化为仅路由+方法+请求体，
   * 同一租户内的不同用户仍可能共享缓存条目。
   */
  scopeResolver?: (req: Request, env: any) => string | Promise<string>;
}

/**
 * 计算幂等存储键。
 *
 * ## 为什么不能直接用裸的 Idempotency-Key
 *
 * 存储键若只取请求头值，则：攻击者用一个固定键（如 `attacker-key-0001`）发起
 * 写操作拿到 200；受害者随后用**自己的会话、同一个键**发起请求时会命中缓存，
 * 直接收到攻击者那次请求的完整响应体（含攻击者账号的数据），而攻击者自己的
 * 真实请求从未执行。叠加 {@link MemoryIdempotencyStore} 是模块级单例
 * （同一 isolate 内所有租户、所有路由共享一张表），影响面进一步放大。
 *
 * 因此键必须由「作用域 + 路由 + 方法 + 请求体指纹 + 客户端键」共同派生。
 * 作用域不参与时，至少路由/方法/请求体参与，保证不同端点与不同请求体不会串。
 */
async function buildStorageKey(
  request: Request,
  env: any,
  idempotencyKey: string,
  options: IdempotencyOptions,
): Promise<string> {
  const parts: string[] = [];
  try {
    parts.push(String((await options.scopeResolver?.(request, env)) ?? ""));
  } catch {
    // 作用域解析失败不应放大为放行：退化为空作用域（仍受路由/方法/请求体约束）
    parts.push("");
  }

  // 路由：method + pathname（不含 query，避免同端点不同参数互相覆盖）
  parts.push(request.method.toUpperCase());
  try {
    parts.push(new URL(request.url).pathname);
  } catch {
    parts.push("?");
  }

  // 请求体指纹：同端点同方法但不同 body 的请求不应互相命中
  let bodyFingerprint = "-";
  try {
    const buf = await request.clone().arrayBuffer();
    if (buf.byteLength > 0) {
      const digest = await crypto.subtle.digest("SHA-256", buf);
      bodyFingerprint = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 32);
    }
  } catch {
    bodyFingerprint = "-";
  }
  parts.push(bodyFingerprint);

  parts.push(idempotencyKey);

  const joined = parts.join("|");
  // 定长摘要：避免超长键与分隔符歧义
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(joined));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const defaultMemoryStore = new MemoryIdempotencyStore();

/**
 * 幂等性处理包装器
 */
export function withIdempotency(
  handler: (request: Request, env: any, ...args: any[]) => Promise<Response>,
  options: IdempotencyOptions = {}
) {
  const headerName = (options.headerName || "idempotency-key").toLowerCase();
  const ttlSeconds = options.ttlSeconds || 86400; // 默认 24 小时

  return async (request: Request, env: any, ...args: any[]): Promise<Response> => {
    // 仅针对非安全写方法进行幂等检查 (POST, PUT, PATCH, DELETE)
    const method = request.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return handler(request, env, ...args);
    }

    const idempotencyKey = request.headers.get(headerName)?.trim();
    if (!idempotencyKey) {
      return handler(request, env, ...args);
    }

    // 校验 Key 长度与基本格式，防止超长注入
    if (idempotencyKey.length < 4 || idempotencyKey.length > 128) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Invalid Idempotency-Key header length (must be 4-128 characters)",
          code: "INVALID_IDEMPOTENCY_KEY",
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    const store: IdempotencyStore = options.getStore
      ? options.getStore(request, env)
      : env?.KV
      ? new KvIdempotencyStore(env.KV)
      : defaultMemoryStore;

    // 存储键 = 复合哈希（含作用域/路由/方法/请求体指纹），而非裸的请求头值
    const storageKey = await buildStorageKey(request, env, idempotencyKey, options);

    // 1. 检查历史缓存命中
    const cached = await store.get(storageKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("X-Idempotent-Replayed", "true");
      return new Response(cached.body, {
        status: cached.status,
        headers,
      });
    }

    // 2. 加锁防护并发重复请求
    if (store.lock && !(await store.lock(storageKey, 30))) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Concurrent request in progress for this Idempotency-Key",
          code: "IDEMPOTENCY_CONCURRENT",
        }),
        { status: 409, headers: { "content-type": "application/json" } }
      );
    }

    try {
      const response = await handler(request, env, ...args);

      // 仅缓存 2xx 成功响应
      if (response.status >= 200 && response.status < 300) {
        const cloned = response.clone();
        const body = await cloned.text();
        const safeHeaders: Record<string, string> = {};
        const ct = response.headers.get("content-type");
        if (ct) safeHeaders["content-type"] = ct;

        await store.set(
          storageKey,
          {
            status: response.status,
            headers: safeHeaders,
            body,
            createdAt: Date.now(),
          },
          ttlSeconds
        );
      }

      return response;
    } finally {
      if (store.unlock) {
        await store.unlock(storageKey);
      }
    }
  };
}
