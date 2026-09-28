import { describe, it, expect, vi } from "vitest";
import { withDbRetry, defaultIsRetryableError } from "../../src/db/index.js";

describe("[E2E Example] 07 - Resilient D1 Database High-Concurrency Retry Pipeline", () => {
  it("orchestrates SQLITE_BUSY retry recovery, jittered exponential backoff, and hard-error fail-fast", async () => {
    let callAttempts = 0;

    // 1. Transient DB Lock scenario (Recovered on 3rd attempt)
    const mockDbQuery = vi.fn().mockImplementation(async () => {
      callAttempts++;
      if (callAttempts < 3) {
        throw new Error("SQLITE_BUSY: database is locked during concurrent bulk insert");
      }
      return { id: "inserted_row_id", success: true };
    });

    const result = await withDbRetry(mockDbQuery, {
      maxRetries: 4,
      initialBackoffMs: 5,
      maxBackoffMs: 20,
    });

    expect((result as any).success).toBe(true);
    expect(callAttempts).toBe(3);

    // 2. Syntax / Non-retryable error (Fails fast without retry)
    const fatalQuery = vi.fn().mockRejectedValue(new Error("SQLITE_ERROR: no such column: nonexistent_col"));
    await expect(withDbRetry(fatalQuery, { maxRetries: 3 })).rejects.toThrow("no such column");
    expect(fatalQuery).toHaveBeenCalledTimes(1);

    // 3. Retryable Error Identification
    expect(defaultIsRetryableError(new Error("D1_ERROR: storage engine busy"))).toBe(true);
    expect(defaultIsRetryableError(new Error("Network connection reset by peer"))).toBe(true);
    expect(defaultIsRetryableError(new Error("FOREIGN KEY constraint failed"))).toBe(false);
  });
});
