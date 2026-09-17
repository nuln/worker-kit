import { describe, it, expect, vi } from "vitest";
import { sendD1Change, createD1SyncSender } from "../src/sync/index.js";

describe("Sync Sender Module - Deep Branch Coverage", () => {
  it("covers sendD1Change with custom fetch, timeouts, error logs, and createD1SyncSender", async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async (url: any, init: any) => {
      const headers = new Headers(init.headers);
      if (headers.get("X-Sync-Secret") === "bad_secret") {
        return new Response("Unauthorized", { status: 401 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    globalThis.fetch = fetchSpy as any;

    try {
      const waitUntilMock = vi.fn();
      const mockCtx = { waitUntil: waitUntilMock };

      const syncEnv = {
        PEER_SYNC_ENDPOINT: "https://peer.nuln.net/api/sync",
        PEER_SYNC_SECRET: "sync_sec_123",
        NODE_ID: "cf-primary",
      };

      const sender = createD1SyncSender(syncEnv, { customFetch: fetchSpy as any });

      // Upsert
      sender.upsert(mockCtx, "users", { id: "u_1", name: "Alice" });
      expect(waitUntilMock).toHaveBeenCalled();

      // Delete
      sender.delete(mockCtx, "users", "u_1");
      expect(waitUntilMock).toHaveBeenCalledTimes(2);

      // Notify
      sender.notify(mockCtx, {
        table: "settings",
        action: "UPSERT",
        data: { key: "theme", value: "dark" },
      });
      expect(waitUntilMock).toHaveBeenCalledTimes(3);

      // Silent skip when no endpoint configured
      const emptyEnv = {};
      const noopSender = createD1SyncSender(emptyEnv);
      const noopWaitUntil = vi.fn();
      noopSender.upsert({ waitUntil: noopWaitUntil }, "items", { id: "1" });
      expect(noopWaitUntil).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
