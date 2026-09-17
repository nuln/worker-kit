import { describe, it, expect, vi } from "vitest";
import { withIdempotency, MemoryIdempotencyStore, KvIdempotencyStore } from "../src/middleware/idempotency.js";

describe("Idempotency Middleware", () => {
  it("passes through GET / HEAD requests without idempotency checking", async () => {
    const handler = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const wrapped = withIdempotency(handler);

    const req = new Request("https://api.nuln.net/items", {
      method: "GET",
      headers: { "idempotency-key": "test-key-123" },
    });
    const res = await wrapped(req, {});
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.headers.get("X-Idempotent-Replayed")).toBeNull();
  });

  it("passes through POST requests without Idempotency-Key header", async () => {
    const handler = vi.fn().mockResolvedValue(new Response("created", { status: 201 }));
    const wrapped = withIdempotency(handler);

    const req = new Request("https://api.nuln.net/items", {
      method: "POST",
      body: JSON.stringify({ item: "book" }),
    });
    const res = await wrapped(req, {});
    expect(res.status).toBe(201);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("validates key length strictly", async () => {
    const handler = vi.fn();
    const wrapped = withIdempotency(handler);

    const reqShort = new Request("https://api.nuln.net/items", {
      method: "POST",
      headers: { "idempotency-key": "ab" },
    });
    const resShort = await wrapped(reqShort, {});
    expect(resShort.status).toBe(400);

    const longKey = "a".repeat(129);
    const reqLong = new Request("https://api.nuln.net/items", {
      method: "POST",
      headers: { "idempotency-key": longKey },
    });
    const resLong = await wrapped(reqLong, {});
    expect(resLong.status).toBe(400);
  });

  it("caches 2xx responses and replays them on duplicate requests", async () => {
    const memoryStore = new MemoryIdempotencyStore();
    let counter = 0;
    const handler = vi.fn().mockImplementation(async () => {
      counter++;
      return new Response(JSON.stringify({ result: "order_created", count: counter }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });

    const wrapped = withIdempotency(handler, {
      getStore: () => memoryStore,
    });

    const req1 = new Request("https://api.nuln.net/orders", {
      method: "POST",
      headers: { "idempotency-key": "order-uuid-9999" },
    });

    // 第一次调用
    const res1 = await wrapped(req1, {});
    expect(res1.status).toBe(201);
    const data1 = (await res1.json()) as any;
    expect(data1.count).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(res1.headers.get("X-Idempotent-Replayed")).toBeNull();

    // 第二次携带相同 Key 重试
    const req2 = new Request("https://api.nuln.net/orders", {
      method: "POST",
      headers: { "idempotency-key": "order-uuid-9999" },
    });
    const res2 = await wrapped(req2, {});
    expect(res2.status).toBe(201);
    const data2 = (await res2.json()) as any;
    expect(data2.count).toBe(1); // 结果不变
    expect(handler).toHaveBeenCalledTimes(1); // 未执行后端 handler
    expect(res2.headers.get("X-Idempotent-Replayed")).toBe("true");
  });

  it("KvIdempotencyStore reads and writes correctly", async () => {
    const mockKv = {
      data: new Map<string, string>(),
      async get(k: string) {
        return this.data.get(k) || null;
      },
      async put(k: string, v: string) {
        this.data.set(k, v);
      },
    };

    const store = new KvIdempotencyStore(mockKv, "custom:");
    await store.set("k1", { status: 200, headers: {}, body: "cached", createdAt: 100 }, 3600);
    const rec = await store.get("k1");
    expect(rec).toEqual({ status: 200, headers: {}, body: "cached", createdAt: 100 });
  });
});
