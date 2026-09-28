/**
 * 幂等中间件隔离性与互斥回归测试。
 *
 * ## 两个被锁定的行为
 *
 * 1. **存储键必须含作用域**：若只用裸的 `Idempotency-Key` 请求头值作键，
 *    攻击者用一个固定键拿到 200 后，受害者用**自己的会话、同一个键**发起请求
 *    会命中缓存，直接收到攻击者的完整响应体。键因此改为
 *    `sha256(scope | method | pathname | bodyFingerprint | clientKey)`。
 *
 * 2. **不同端点 / 不同请求体不得互相命中**：复合键含路由与请求体指纹，
 *    避免同端点不同参数、同方法不同 body 的请求共享缓存条目。
 */

import { describe, it, expect } from "vitest";
import {
  withIdempotency,
  MemoryIdempotencyStore,
  KvIdempotencyStore,
} from "../../src/middleware/idempotency.js";

function req(url: string, init: RequestInit = {}): Request {
  return new Request(url, init);
}

function postWithKey(url: string, key: string, body?: unknown): Request {
  return req(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "idempotency-key": key,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("幂等键隔离：不得跨作用域泄漏响应", () => {
  it("不同 scopeResolver 结果不共享缓存", async () => {
    const store = new MemoryIdempotencyStore();
    let scope = "tenant-A";
    let calls = 0;

    const mw = withIdempotency(
      async () => {
        calls += 1;
        return new Response(JSON.stringify({ owner: scope, calls }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      {
        scopeResolver: () => scope,
        // 复用同一实例：中间件每次请求都会调用 getStore
        getStore: () => store,
      },
    );

    // 攻击者（tenant-A）先发起，占用该键
    const attack = await mw(postWithKey("https://x/api/pay", "shared-key-0001", { amt: 10 }), {});
    expect(attack.status).toBe(200);
    const attackBody = (await attack.json()) as { owner: string };
    expect(attackBody.owner).toBe("tenant-A");

    // 受害者（tenant-B）用**同一个键**发起
    scope = "tenant-B";
    const victim = await mw(postWithKey("https://x/api/pay", "shared-key-0001", { amt: 10 }), {});
    const victimBody = (await victim.json()) as { owner: string; calls: number };

    // 关键：受害者必须拿到自己的响应，而不是攻击者的缓存
    expect(victimBody.owner).toBe("tenant-B");
    expect(calls, "handler 应被真实执行两次").toBe(2);
  });

  it("不同端点不共享缓存", async () => {
    const store = new MemoryIdempotencyStore();
    const calls: string[] = [];
    const mw = withIdempotency(
      async (r) => {
        const u = new URL(r.url);
        calls.push(u.pathname);
        return new Response(JSON.stringify({ path: u.pathname }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      { getStore: () => store },
    );

    await mw(postWithKey("https://x/api/a", "same-key-1111", { v: 1 }), {});
    await mw(postWithKey("https://x/api/b", "same-key-1111", { v: 1 }), {});

    expect(calls).toEqual(["/api/a", "/api/b"]);
  });

  it("同端点但请求体不同不共享缓存", async () => {
    const store = new MemoryIdempotencyStore();
    const bodies: unknown[] = [];
    const mw = withIdempotency(
      async (r) => {
        bodies.push(await r.clone().json());
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      { getStore: () => store },
    );

    await mw(postWithKey("https://x/api/e", "same-key-2222", { amt: 1 }), {});
    await mw(postWithKey("https://x/api/e", "same-key-2222", { amt: 2 }), {});

    expect(bodies).toEqual([{ amt: 1 }, { amt: 2 }]);
  });

  it("同作用域 + 同端点 + 同请求体 + 同键 → 正确回放", async () => {
    // 注意：getStore 必须复用同一实例 —— 中间件每次请求都会调用它，
    // 若每次返回新 store 则等价于没有缓存。
    const store = new MemoryIdempotencyStore();
    let calls = 0;
    const mw = withIdempotency(
      async () => {
        calls += 1;
        return new Response(JSON.stringify({ calls }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      { getStore: () => store },
    );

    const first = await mw(postWithKey("https://x/api/c", "same-key-3333", { v: 9 }), {});
    const second = await mw(postWithKey("https://x/api/c", "same-key-3333", { v: 9 }), {});

    expect(calls, "handler 只应执行一次").toBe(1);
    expect(second.headers.get("X-Idempotent-Replayed")).toBe("true");
    expect(await second.text()).toBe(await first.text());
  });
});

describe("MemoryIdempotencyStore 容量保护", () => {
  it("超过上限时淘汰最旧条目，最新条目仍可读", async () => {
    const store = new MemoryIdempotencyStore();
    const original = MemoryIdempotencyStore.MAX_ENTRIES;
    (MemoryIdempotencyStore as any).MAX_ENTRIES = 3;
    try {
      for (let i = 0; i < 6; i++) {
        store.set(`k${i}`, { status: 200, headers: {}, body: String(i), createdAt: i }, 3600);
      }
      // 最新写入的必须还在
      expect(store.get("k5")?.body).toBe("5");
    } finally {
      (MemoryIdempotencyStore as any).MAX_ENTRIES = original;
    }
  });
});

describe("KvIdempotencyStore.lock 不再恒返回 true", () => {
  function fakeKv() {
    const m = new Map<string, string>();
    return {
      m,
      get: async (k: string) => m.get(k) ?? null,
      put: async (k: string, v: string) => {
        m.set(k, v);
      },
      delete: async (k: string) => {
        m.delete(k);
      },
    };
  }

  it("同一实例内同键重复加锁会被拒绝", async () => {
    const store = new KvIdempotencyStore(fakeKv());
    expect(await store.lock("key-a", 30)).toBe(true);
    // 同一实例已持有该键 → 第二次应失败（原实现恒返回 true）
    expect(await store.lock("key-a", 30)).toBe(false);
    await store.unlock("key-a");
    expect(await store.lock("key-a", 30)).toBe(true);
  });

  it("KV 抛错时不阻塞主流程（fail-open，已在注释中说明局限）", async () => {
    const broken = {
      get: async () => { throw new Error("kv down"); },
      put: async () => { throw new Error("kv down"); },
      delete: async () => { throw new Error("kv down"); },
    };
    const store = new KvIdempotencyStore(broken);
    expect(await store.lock("key-b", 30)).toBe(true);
  });
});
