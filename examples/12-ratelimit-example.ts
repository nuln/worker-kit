/**
 * Example 12: High-Throughput Sliding Window Rate Limiter
 *
 * Demonstrates:
 * 1. Sub-millisecond in-memory rate limiting via RateLimiterDO
 * 2. D1 / KV fallback for edge environments without Durable Objects
 * 3. IETF standard RateLimit-* and Retry-After response headers injection
 */

import {
  RateLimiterDO,
  RateLimitService,
  rateLimitMiddleware,
  applyRateLimitHeaders,
} from "@nuln/worker-kit";

export async function runRateLimitExample(request: Request, env: any) {
  console.log("=== [Example 12] High-Throughput Rate Limiting ===");

  const service = new RateLimitService(env.DB, env.RATE_LIMITER_DO);

  // Consume 1 quota from client IP (Limit: 60 reqs per 60s)
  const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
  const result = await service.consume(`ip:${clientIp}`, 60, 60);

  const headers = new Headers({ "Content-Type": "application/json" });
  applyRateLimitHeaders(headers, result);

  if (!result.ok) {
    return new Response(JSON.stringify({ error: "Too Many Requests" }), { status: 429, headers });
  }

  return new Response(JSON.stringify({ ok: true, remaining: result.remaining }), { status: 200, headers });
}
