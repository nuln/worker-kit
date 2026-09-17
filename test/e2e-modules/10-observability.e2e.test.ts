import { describe, it, expect, vi } from "vitest";
import { createHealthCheckHandler } from "../../src/observability/index.js";

describe("[E2E Example] 10 - Microservice Health Probes & Deep Dependency Diagnostic", () => {
  it("runs full deep health check on D1, KV, R2 and external dependency cluster", async () => {
    // 1. Setup unified health check handler
    const healthHandler = createHealthCheckHandler({
      serviceName: "Console",
      version: "2.5.0",
      statusText: "healthy",
      checks: {
        d1: vi.fn().mockResolvedValue(true),
        kv: vi.fn().mockResolvedValue(true),
        r2: vi.fn().mockResolvedValue(true),
        custom: {
          pushGateway: vi.fn().mockResolvedValue(true),
          oidcIdp: vi.fn().mockResolvedValue(true),
        },
      },
    });

    // 2. Query /health probe
    const req = new Request("https://console.nuln.net/health");
    const res = await healthHandler(req, {});

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store, no-cache, must-revalidate");

    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.status).toBe("healthy");
    expect(body.service).toBe("Console");
    expect(body.version).toBe("2.5.0");
    expect(body.latency.d1).toBeDefined();
    expect(body.latency.pushGateway).toBeDefined();
    expect(body.latency.total).toBeGreaterThanOrEqual(0);

    // 3. Simulating downstream failure
    const degradedHandler = createHealthCheckHandler({
      serviceName: "Console",
      checks: {
        d1: vi.fn().mockResolvedValue(true),
        custom: {
          pushGateway: vi.fn().mockRejectedValue(new Error("Connection Timeout (504)")),
        },
      },
    });

    const failRes = await degradedHandler(req, {});
    expect(failRes.status).toBe(503);
    const failBody = (await failRes.json()) as any;
    expect(failBody.ok).toBe(false);
    expect(failBody.status).toBe("degraded");
    expect(failBody.errors.pushGateway).toContain("Connection Timeout");
  });
});
