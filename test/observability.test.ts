import { describe, it, expect, vi } from "vitest";
import { createHealthCheckHandler, defaultD1Check, defaultKvCheck } from "../src/observability/health.js";

describe("Observability & Health Checks", () => {
  it("defaultD1Check should validate database connection", async () => {
    expect(await defaultD1Check(null)).toBe(false);
    expect(await defaultD1Check({})).toBe(false);

    const mockDbSuccess = {
      prepare: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue({ 1: 1 }),
      }),
    };
    expect(await defaultD1Check(mockDbSuccess)).toBe(true);

    const mockDbFail = {
      prepare: vi.fn().mockReturnValue({
        first: vi.fn().mockRejectedValue(new Error("D1 connection refused")),
      }),
    };
    expect(await defaultD1Check(mockDbFail)).toBe(false);
  });

  it("defaultKvCheck should validate kv connection", async () => {
    expect(await defaultKvCheck(null)).toBe(false);
    expect(await defaultKvCheck({})).toBe(false);

    const mockKvSuccess = {
      get: vi.fn().mockResolvedValue(null),
    };
    expect(await defaultKvCheck(mockKvSuccess)).toBe(true);

    const mockKvFail = {
      get: vi.fn().mockRejectedValue(new Error("KV unreachable")),
    };
    expect(await defaultKvCheck(mockKvFail)).toBe(false);
  });

  it("createHealthCheckHandler returns 200 when all checks pass", async () => {
    const handler = createHealthCheckHandler({
      serviceName: "TestService",
      version: "1.0.0",
      checks: {
        d1: async () => true,
        kv: async () => true,
        custom: {
          r2: async () => true,
        },
      },
    });

    const res = await handler(new Request("https://test.nuln.net/health"), {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("healthy");
    expect(body.service).toBe("TestService");
    expect(body.version).toBe("1.0.0");
    expect(body.latency.d1).toBeDefined();
    expect(body.latency.kv).toBeDefined();
    expect(body.latency.r2).toBeDefined();
    expect(body.latency.total).toBeDefined();
  });

  it("createHealthCheckHandler returns 503 when a check fails", async () => {
    const handler = createHealthCheckHandler({
      serviceName: "TestService",
      checks: {
        d1: async () => false,
        kv: async () => {
          throw new Error("KV network timeout");
        },
      },
    });

    const res = await handler(new Request("https://test.nuln.net/health"), {});
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.status).toBe("degraded");
    expect(body.errors?.d1).toBe("D1 check returned false");
    expect(body.errors?.kv).toBe("KV network timeout");
  });
});
