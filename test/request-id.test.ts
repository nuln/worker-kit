import { describe, it, expect } from "vitest";
import { requestIdMiddleware, createTracedFetch } from "../src/middleware/request-id";

describe("@nuln/worker-kit/middleware - requestIdMiddleware", () => {
  it("generates a new X-Request-ID when not provided in request", async () => {
    const middleware = requestIdMiddleware();
    const headers = new Headers();
    const context: any = {
      req: { header: () => undefined },
      res: { headers },
      vars: {},
      set(k: string, v: any) { this.vars[k] = v; },
      get(k: string) { return this.vars[k]; },
    };

    let nextCalled = false;
    await middleware(context, async () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(context.get("requestId")).toBeDefined();
    expect(headers.get("X-Request-ID")).toBe(context.get("requestId"));
  });

  it("reuses existing X-Request-ID or traceparent from request headers", async () => {
    const middleware = requestIdMiddleware();

    // 1. With X-Request-ID
    const headers1 = new Headers();
    const ctx1: any = {
      req: { header: (h: string) => h === "X-Request-ID" ? "custom-trace-12345" : undefined },
      res: { headers: headers1 },
      vars: {},
      set(k: string, v: any) { this.vars[k] = v; },
      get(k: string) { return this.vars[k]; },
    };
    await middleware(ctx1, async () => {});
    expect(headers1.get("X-Request-ID")).toBe("custom-trace-12345");
    expect(ctx1.get("requestId")).toBe("custom-trace-12345");

    // 2. With traceparent
    const headers2 = new Headers();
    const ctx2: any = {
      req: { header: (h: string) => h === "traceparent" ? "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" : undefined },
      res: { headers: headers2 },
      vars: {},
      set(k: string, v: any) { this.vars[k] = v; },
      get(k: string) { return this.vars[k]; },
    };
    await middleware(ctx2, async () => {});
    expect(headers2.get("X-Request-ID")).toBe("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
  });

  it("createTracedFetch attaches X-Request-ID to downstream calls", async () => {
    let downstreamHeader = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: any, init?: any) => {
      const h = new Headers(init?.headers);
      downstreamHeader = h.get("X-Request-ID") || "";
      return new Response(JSON.stringify({ downstream: true }));
    };

    try {
      const ctx: any = {
        get(k: string) { return k === "requestId" ? "parent-trace-888" : undefined; },
      };
      const tracedFetch = createTracedFetch(ctx);
      await tracedFetch("https://downstream.test/api");
      expect(downstreamHeader).toBe("parent-trace-888");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
