import { describe, it, expect } from "vitest";
import {
  createHealthCheckHandler,
  defaultD1Check,
  defaultKvCheck,
} from "../src/observability/health.js";

describe("Observability Module - Deep Branch Coverage", () => {
  it("covers defaultD1Check and defaultKvCheck null/invalid bindings", async () => {
    expect(await defaultD1Check(null)).toBe(false);
    expect(await defaultD1Check({})).toBe(false);
    expect(await defaultD1Check({ prepare: () => { throw new Error("db down"); } })).toBe(false);

    expect(await defaultKvCheck(null)).toBe(false);
    expect(await defaultKvCheck({})).toBe(false);
    expect(await defaultKvCheck({ get: () => { throw new Error("kv down"); } })).toBe(false);
  });

  it("covers createHealthCheckHandler degraded with R2, KV, D1, and custom check errors", async () => {
    const handler = createHealthCheckHandler({
      serviceName: "mail",
      version: "1.2.0",
      checks: {
        d1: async () => { throw new Error("D1 connection refused"); },
        kv: async () => false,
        r2: async () => { throw new Error("R2 bucket timeout"); },
        custom: {
          redis: async () => false,
          upstream: async () => { throw new Error("502 Bad Gateway"); },
        },
      },
    });

    const res = await handler(new Request("https://mail.nuln.net/health"), {});
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(false);
    expect(body.status).toBe("degraded");
    expect(body.errors.d1).toBe("D1 connection refused");
    expect(body.errors.kv).toBe("KV check returned false");
    expect(body.errors.r2).toBe("R2 bucket timeout");
    expect(body.errors.redis).toBe("redis check returned false");
    expect(body.errors.upstream).toBe("502 Bad Gateway");
  });

  it("covers createHealthCheckHandler default DB env ping error branch", async () => {
    const handler = createHealthCheckHandler({
      serviceName: "Tower",
    });

    const mockFailingEnv = {
      DB: {
        prepare() {
          return {
            async first() {
              throw new Error("D1 internal query lock");
            },
          };
        },
      },
    };

    const res = await handler(new Request("https://tower.nuln.net/health"), mockFailingEnv);
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(false);
    expect(body.errors.d1).toBe("D1 ping query failed");
  });
});
