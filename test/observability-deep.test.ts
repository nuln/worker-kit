import { describe, it, expect, vi } from "vitest";
import {
  createHealthCheckHandler,
  defaultD1Check,
  defaultKvCheck,
} from "../src/observability/health.js";

describe("@nuln/worker-kit/observability/health - Deep Health Probe Coverage", () => {
  it("defaultD1Check and defaultKvCheck return boolean status and handle errors", async () => {
    expect(await defaultD1Check(null)).toBe(false);
    expect(await defaultD1Check({})).toBe(false);

    const goodDb = {
      prepare: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue({ 1: 1 }) }),
    };
    expect(await defaultD1Check(goodDb)).toBe(true);

    const failDb = {
      prepare: vi.fn().mockReturnValue({ first: vi.fn().mockRejectedValue(new Error("D1 down")) }),
    };
    expect(await defaultD1Check(failDb)).toBe(false);

    expect(await defaultKvCheck(null)).toBe(false);
    expect(await defaultKvCheck({})).toBe(false);

    const goodKv = { get: vi.fn().mockResolvedValue(null) };
    expect(await defaultKvCheck(goodKv)).toBe(true);

    const failKv = { get: vi.fn().mockRejectedValue(new Error("KV timeout")) };
    expect(await defaultKvCheck(failKv)).toBe(false);
  });

  it("createHealthCheckHandler executes custom checks and handles degrades with 503", async () => {
    const handler = createHealthCheckHandler({
      serviceName: "Tower",
      version: "1.2.0",
      checks: {
        d1: vi.fn().mockResolvedValue(true),
        kv: vi.fn().mockRejectedValue(new Error("KV cluster unreachable")),
        r2: vi.fn().mockResolvedValue(false),
        custom: {
          redis: vi.fn().mockResolvedValue(true),
          authService: vi.fn().mockRejectedValue(new Error("Auth 500")),
        },
      },
    });

    const req = new Request("http://localhost/health");
    const res = await handler(req, {});

    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(false);
    expect(body.status).toBe("degraded");
    expect(body.service).toBe("Tower");
    expect(body.version).toBe("1.2.0");
    expect(body.errors?.kv).toBe("KV cluster unreachable");
    expect(body.errors?.r2).toBe("R2 check returned false");
    expect(body.errors?.authService).toBe("Auth 500");
  });

  it("createHealthCheckHandler handles all-healthy state with 200", async () => {
    const handler = createHealthCheckHandler({
      serviceName: "Mail",
      checks: {
        d1: vi.fn().mockResolvedValue(true),
        kv: vi.fn().mockResolvedValue(true),
        r2: vi.fn().mockResolvedValue(true),
      },
    });

    const res = await handler(new Request("http://localhost/health"), {});
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.status).toBe("healthy");
    expect(json.data.status).toBe("ok"); // Mail service maps to "ok"
    expect(json.latency.total).toBeGreaterThanOrEqual(0);
  });

  it("createHealthCheckHandler uses default env.DB probe if checks.d1 omitted", async () => {
    const handler = createHealthCheckHandler({
      serviceName: "OIDC",
    });

    const envWithDb = {
      DB: {
        prepare: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue({ 1: 1 }) }),
      },
    };

    const res = await handler(new Request("http://localhost/health"), envWithDb);
    expect(res.status).toBe(200);

    const envWithBrokenDb = {
      DB: {
        prepare: vi.fn().mockReturnValue({ first: vi.fn().mockRejectedValue(new Error("DB locked")) }),
      },
    };

    const degradedRes = await handler(new Request("http://localhost/health"), envWithBrokenDb);
    expect(degradedRes.status).toBe(503);
  });
});
