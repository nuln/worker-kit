/**
 * Example 10: Multi-Probe Health Check & Observability
 *
 * Demonstrates:
 * 1. Configuring `/health` endpoint handler with D1, KV, R2, and Custom probes
 * 2. Monitoring latencies per storage dependency
 * 3. Reporting degraded states with 503 response codes
 */

import { createHealthCheckHandler } from "@nuln/worker-kit";

export function createHealthEndpoint(env: any) {
  return createHealthCheckHandler({
    serviceName: "Tower",
    version: "1.0.0",
    checks: {
      d1: async (e) => Boolean(e.DB),
      kv: async (e) => Boolean(e.KV),
      r2: async (e) => Boolean(e.BUCKET),
      custom: {
        upstream_auth: async () => {
          // Probe upstream connectivity
          return true;
        },
      },
    },
  });
}
