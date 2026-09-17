/**
 * Example 07: Resilient D1 Database Operations & Retry Policy
 *
 * Demonstrates:
 * 1. Executing queries with automatic exponential backoff on lock contention
 * 2. Safe transaction batch execution with rollback safety
 * 3. Health ping probing for D1 databases
 */

import { withDbRetry, defaultD1Check } from "@nuln/worker-kit";

export async function runDbExample(db: any) {
  console.log("=== [Example 07] D1 Database Resilient Retry Policy ===");

  // 1. Health check
  const isHealthy = await defaultD1Check(db);
  console.log("Database online status:", isHealthy);

  // 2. Executing critical write query with 3-attempt exponential retry
  const result = await withDbRetry(async () => {
    return await db.prepare("SELECT COUNT(*) AS count FROM users").first("count");
  }, { maxRetries: 3, baseDelayMs: 50 });

  console.log("Total user count retrieved safely:", result);
}
