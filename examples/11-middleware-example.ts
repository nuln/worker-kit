/**
 * Example 11: Idempotency Key & Distributed Request Tracing Middleware
 *
 * Demonstrates:
 * 1. Attaching `X-Request-ID` across distributed worker calls via `createTracedFetch`
 * 2. Protecting critical payment/order endpoints against duplicate execution using `withIdempotency`
 * 3. Replaying cached responses upon identical Idempotency-Key headers
 */

import {
  requestIdMiddleware,
  createTracedFetch,
  withIdempotency,
  MemoryIdempotencyStore,
} from "@nuln/worker-kit";

export function setupApiMiddlewares() {
  const store = new MemoryIdempotencyStore();

  // 1. Raw Business Handler
  const handlePayment = async (request: Request) => {
    return new Response(JSON.stringify({ orderId: "ord_1001", paid: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  // 2. Wrap with Idempotency Protection (24h TTL)
  const idempotentPaymentHandler = withIdempotency(handlePayment, {
    headerName: "X-Idempotency-Key",
    ttlSeconds: 86400,
    getStore: () => store,
  });

  return { idempotentPaymentHandler };
}
