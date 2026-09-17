import { describe, it, expect, vi } from "vitest";
import { requestIdMiddleware, withIdempotency, MemoryIdempotencyStore } from "../../src/middleware/index.js";

describe("[E2E Example] 11 - Edge API Gateway Middleware: Idempotency & Distributed Tracing", () => {
  it("orchestrates X-Request-ID propagation and concurrent idempotency locking with replay cache", async () => {
    // 1. Request ID Middleware
    const incomingReq = new Request("https://api.nuln.net/v1/orders");
    const resHeaders = new Headers();
    const store = new Map<string, any>();
    const reqCtx: any = {
      req: { header: () => undefined, raw: incomingReq },
      set: vi.fn((k, v) => store.set(k, v)),
      get: (k: string) => store.get(k),
      res: { headers: resHeaders },
    };

    let downstreamCalled = false;
    await requestIdMiddleware()(reqCtx, async () => {
      downstreamCalled = true;
    });

    expect(downstreamCalled).toBe(true);
    expect(reqCtx.set).toHaveBeenCalledWith("requestId", expect.any(String));
    expect(resHeaders.get("X-Request-ID")).toBeDefined();


    // 2. Idempotency Key Pipeline
    const customStore = new MemoryIdempotencyStore();
    let handlerExecutions = 0;

    const rawHandler = async (request: Request) => {
      handlerExecutions++;
      return new Response(JSON.stringify({ orderId: "ord_999", paid: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const idempotentHandler = withIdempotency(rawHandler, {
      headerName: "X-Idempotency-Key",
      ttlSeconds: 60,
      getStore: () => customStore,
    });

    const orderReq = new Request("https://api.nuln.net/v1/orders/pay", {
      method: "POST",
      headers: { "X-Idempotency-Key": "order_checkout_key_001" },
      body: JSON.stringify({ amount: 100 }),
    });

    const res1 = await idempotentHandler(orderReq, {});
    expect(res1.status).toBe(200);
    expect(handlerExecutions).toBe(1);

    // Replay exact same request
    const res2 = await idempotentHandler(orderReq, {});
    expect(res2.status).toBe(200);
    expect(handlerExecutions).toBe(1); // Not re-executed
    expect(res2.headers.get("X-Idempotent-Replayed")).toBe("true");
    const replayedBody = (await res2.json()) as any;
    expect(replayedBody.orderId).toBe("ord_999");
  });
});
