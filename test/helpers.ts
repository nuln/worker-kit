/**
 * @nuln/worker-kit/test/helpers — 测试辅助工具
 *
 * 依据 AGENTS §9 的测试套件分类规范设立（"测试辅助工具（Mock 上下文、DB 种子、
 * CSRF 工具等）"）。当前提供四类复用件：
 *
 * 1. **D1 mock**：支持 `PRAGMA table_info` 的可编程数据库替身
 * 2. **HTTP 上下文**：模拟 Hono 风格的 `c.req` / `c.res`
 * 3. **幂等存储**：内存实现，便于测试 `withIdempotency`
 * 4. **WebAuthn**：从既有实现导出的规范化存储键
 */

import type { IdempotencyRecord, IdempotencyStore } from "../src/middleware/idempotency.js";

/* ── D1 mock ────────────────────────────────────────────────────────── */

export interface MockDbOptions {
  /** 本地表实际拥有的列名；决定 LWW 守卫是否生效（见 src/sync/receiver.ts） */
  columns?: string[];
  /** `prepare()` 匹配到的 SQL 后返回该结果（用于 `.first()`） */
  firstResult?: unknown;
  /** `.all()` 的返回结果 */
  allResults?: Array<Record<string, unknown>>;
  /** 对 `prepare` 抛错，用于验证错误分支 */
  throwOn?: RegExp;
}

export interface MockDb {
  /** 所有实际执行过的写操作（`run()` 调用） */
  executed: Array<{ sql: string; bindings: unknown[] }>;
  /** 所有 prepare 过的 SQL（含只读的 PRAGMA） */
  prepared: string[];
  prepare(sql: string): any;
  batch(stmts: any[]): Promise<unknown>;
}

/**
 * 构造可编程的 D1 替身。
 *
 * 与「只记录 SQL」的朴素 mock 不同，本替身会区分 `PRAGMA table_info`
 * （返回配置的列名）与普通语句，这样 LWW 相关测试才能验证
 * 「接收端依据**本地表结构**而非载荷形状决定是否施加时序保护」。
 */
export function createMockDb(options: MockDbOptions = {}): MockDb {
  const {
    columns = ["id", "email", "updated_at"],
    firstResult = null,
    allResults = [],
    throwOn,
  } = options;

  const executed: Array<{ sql: string; bindings: unknown[] }> = [];
  const prepared: string[] = [];

  const db: MockDb = {
    executed,
    prepared,
    prepare(sql: string) {
      prepared.push(sql);
      if (throwOn && throwOn.test(sql)) {
        throw new Error(`mock: SQL matched throwOn: ${sql}`);
      }
      if (/PRAGMA table_info/i.test(sql)) {
        return {
          all: async () => ({
            success: true,
            results: columns.map((name) => ({ name })),
          }),
          raw: async () => [{ name: "cid" }],
        };
      }
      return {
        bind: (...bindings: unknown[]) => ({
          run: async () => {
            executed.push({ sql, bindings });
            return { success: true, meta: { changes: 1 } };
          },
          first: async <T>() => firstResult as T,
          all: async () => ({ success: true, results: allResults }),
        }),
        first: async <T>() => firstResult as T,
        all: async () => ({ success: true, results: allResults }),
        run: async () => {
          executed.push({ sql, bindings: [] });
          return { success: true, meta: { changes: 1 } };
        },
      };
    },
    async batch(stmts: any[]) {
      for (const st of stmts) {
        if (typeof st?.run === "function") await st.run();
      }
      return [];
    },
  };

  return db;
}

/* ── HTTP 上下文 ─────────────────────────────────────────────────────── */

export interface MockContext {
  req: { raw: Request; header(name: string): string | undefined };
  res: { headers: Headers };
  env: Record<string, unknown>;
  reqOrigin?: string;
}

/** 构造 Hono 风格的 `c` 替身。 */
export function createMockContext(
  request: Request,
  env: Record<string, unknown> = {},
): MockContext {
  return {
    req: {
      raw: request,
      header: (name: string) => request.headers.get(name) ?? undefined,
    },
    res: { headers: new Headers() },
    env,
  };
}

/* ── 幂等存储 ────────────────────────────────────────────────────────── */

/** 内存幂等存储，便于测试 `withIdempotency` 的回放与并发行为。 */
export class TestIdempotencyStore implements IdempotencyStore {
  readonly records = new Map<string, IdempotencyRecord>();
  readonly locks = new Set<string>();
  /** 记录所有被读取的键，便于断言「键的作用域构成」 */
  readonly readKeys: string[] = [];

  get(key: string): IdempotencyRecord | null {
    this.readKeys.push(key);
    return this.records.get(key) ?? null;
  }

  set(key: string, record: IdempotencyRecord): void {
    this.records.set(key, record);
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

/* ── 请求构造 ────────────────────────────────────────────────────────── */

/** 构造带幂等键的 POST 请求。 */
export function postWithKey(
  url: string,
  key: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "idempotency-key": key,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** 构造带指定语言的请求（用于 i18n / lang 探测用例）。 */
export function requestWithLang(url: string, acceptLanguage: string, cookie?: string): Request {
  const headers: Record<string, string> = { "accept-language": acceptLanguage };
  if (cookie) headers.cookie = cookie;
  return new Request(url, { headers });
}

/* ── fetch stub ──────────────────────────────────────────────────────── */

export type FetchStub = (url: string, init: any) => Response | Promise<Response>;

/**
 * 临时替换 `globalThis.fetch`，返回一个还原函数。
 *
 * 务必用 `const restore = stubFetch(...); try { … } finally { restore() }`
 * 的形式调用，避免污染同文件内的后续用例。
 */
export function stubFetch(impl: FetchStub): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any) =>
    Promise.resolve(impl(String(input?.url ?? input), init))) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}
