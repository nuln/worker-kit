import { describe, it, expect, vi } from "vitest";
import { withDbRetry, defaultIsRetryableError } from "../src/db/retry";

describe("@nuln/worker-kit/db - withDbRetry", () => {
  it("succeeds on first attempt without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const res = await withDbRetry(fn);
    expect(res).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on SQLITE_BUSY error and succeeds", async () => {
    let callCount = 0;
    const fn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error("SQLITE_BUSY: database is locked");
      }
      return "recovered";
    });

    const res = await withDbRetry(fn, { initialBackoffMs: 5, maxRetries: 3 });
    expect(res).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws if non-retryable error occurs", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("SYNTAX_ERROR: invalid sql"));
    await expect(withDbRetry(fn, { maxRetries: 3 })).rejects.toThrow("SYNTAX_ERROR");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting maxRetries on continuous lock contention", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("D1_ERROR: lock contention"));
    await expect(withDbRetry(fn, { initialBackoffMs: 5, maxRetries: 2 })).rejects.toThrow("D1_ERROR");
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("defaultIsRetryableError correctly identifies retryable errors", () => {
    expect(defaultIsRetryableError(new Error("sqlite_busy"))).toBe(true);
    expect(defaultIsRetryableError(new Error("Database is locked"))).toBe(true);
    expect(defaultIsRetryableError(new Error("Network connection reset"))).toBe(true);
    expect(defaultIsRetryableError(new Error("table users not found"))).toBe(false);
    expect(defaultIsRetryableError(null)).toBe(false);
  });
});
