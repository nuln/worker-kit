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

  set(key: string, record: IdempotencyRecord, ttlSeconds: number): void {
    this.cache.set(key, {
      record,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
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

  async lock(_key: string, _ttlSeconds: number): Promise<boolean> {
    return true;
  }

  async unlock(_key: string): Promise<void> {}
}

export interface IdempotencyOptions {
  headerName?: string;
  ttlSeconds?: number;
  getStore?: (req: Request, env: any) => IdempotencyStore;
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

    // 1. 检查历史缓存命中
    const cached = await store.get(idempotencyKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("X-Idempotent-Replayed", "true");
      return new Response(cached.body, {
        status: cached.status,
        headers,
      });
    }

    // 2. 加锁防护并发重复请求
    if (store.lock && !(await store.lock(idempotencyKey, 30))) {
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
          idempotencyKey,
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
        await store.unlock(idempotencyKey);
      }
    }
  };
}
