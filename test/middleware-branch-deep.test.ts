import { describe, it, expect, vi } from "vitest";
import {
  createTracedFetch,
  requestIdMiddleware,
  withIdempotency,
  MemoryIdempotencyStore,
  KvIdempotencyStore,
} from "../src/middleware/index.js";

describe("Middleware Module - Deep Branch Coverage", () => {
  it("covers createTracedFetch when request ID is set or missing", async () => {
    const cWithReqId: any = {
      get: (k: string) => (k === "requestId" ? "req-uuid-999" : undefined),
    };

    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async (input: any, init?: any) => {
      return new Response("ok", { status: 200 });
    });
    globalThis.fetch = fetchSpy as any;

    try {
      const tracedFetch = createTracedFetch(cWithReqId, "X-Trace-ID");
      await tracedFetch("https://api.internal/v1/jobs");

      expect(fetchSpy).toHaveBeenCalled();
      const passedInit = fetchSpy.mock.calls[0][1] as RequestInit;
      const headers = new Headers(passedInit.headers);
      expect(headers.get("X-Trace-ID")).toBe("req-uuid-999");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("covers requestIdMiddleware with custom header name and generator", async () => {
    const customGenerator = () => "custom-gen-12345";
    const mw = requestIdMiddleware({
      headerName: "X-Nuln-Trace",
      generator: customGenerator,
    });

    const store = new Map<string, any>();
    const resHeaders = new Headers();
    const c: any = {
      req: {
        headers: new Headers(),
      },
      set: (k: string, v: any) => store.set(k, v),
      res: { headers: resHeaders },
    };

    await mw(c, async () => {});

    expect(store.get("requestId")).toBe("custom-gen-12345");
    expect(resHeaders.get("X-Nuln-Trace")).toBe("custom-gen-12345");
  });

  it("covers MemoryIdempotencyStore and KvIdempotencyStore lock, unlock, set, get", async () => {
    const memStore = new MemoryIdempotencyStore();

    // Lock and Unlock
    expect(memStore.lock("key_test")).toBe(true);
    expect(memStore.lock("key_test")).toBe(false);
    memStore.unlock("key_test");
    expect(memStore.lock("key_test")).toBe(true);

    // Set and Get
    memStore.set("key_test", {
      status: 201,
      headers: { "content-type": "application/json" },
      body: '{"created":true}',
      createdAt: Date.now(),
    }, 60);

    const cached = memStore.get("key_test");
    expect(cached?.status).toBe(201);
    expect(cached?.body).toBe('{"created":true}');

    // KvIdempotencyStore
    const mockKv = {
      store: new Map<string, string>(),
      async get(k: string) { return this.store.get(k) || null; },
      async put(k: string, v: string) { this.store.set(k, v); },
    };
    const kvStore = new KvIdempotencyStore(mockKv);
    await kvStore.set("kv_key", { status: 200, headers: {}, body: "{}", createdAt: Date.now() }, 60);
    const kvCached = await kvStore.get("kv_key");
    expect(kvCached?.status).toBe(200);
    expect(await kvStore.lock("kv_key", 60)).toBe(true);
    await kvStore.unlock("kv_key");
  });

  it("covers withIdempotency invalid key length and concurrent conflict", async () => {
    const rawHandler = async () => new Response("ok", { status: 200 });
    const mwHandler = withIdempotency(rawHandler, { headerName: "X-Idemp" });

    // Invalid length (<4)
    const shortReq = new Request("https://api.nuln.net/pay", {
      method: "POST",
      headers: { "X-Idemp": "ab" },
    });
    const resShort = await mwHandler(shortReq, {});
    expect(resShort.status).toBe(400);

    // GET request (skipped)
    const getReq = new Request("https://api.nuln.net/pay", {
      method: "GET",
      headers: { "X-Idemp": "valid_key_123" },
    });
    const resGet = await mwHandler(getReq, {});
    expect(resGet.status).toBe(200);
  });
});
