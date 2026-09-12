import { describe, it, expect, vi } from "vitest";
import { sendD1Change, createD1SyncSender, handleD1SyncRequest } from "../src/sync/index.js";

describe("@nuln/worker-kit/sync", () => {
  describe("sendD1Change / createD1SyncSender (Sender)", () => {
    it("should silently skip if BACKUP_SYNC_ENDPOINT is not configured", () => {
      const customFetch = vi.fn();
      const waitUntil = vi.fn();

      sendD1Change(
        { waitUntil },
        {}, // empty env
        { table: "users", action: "UPSERT", data: { id: "u1", email: "test@example.com" } },
        { customFetch }
      );

      expect(customFetch).not.toHaveBeenCalled();
      expect(waitUntil).not.toHaveBeenCalled();
    });

    it("should call fetch via waitUntil when endpoint and secret are present", async () => {
      let capturedPromise: Promise<unknown> | null = null;
      const waitUntil = vi.fn((p: Promise<unknown>) => {
        capturedPromise = p;
      });

      const customFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, synced: true, timestamp: Date.now() }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const env = {
        BACKUP_SYNC_ENDPOINT: "https://nas-backup.com/api/sync",
        BACKUP_SYNC_SECRET: "my_secret_token",
      };

      const sender = createD1SyncSender(env, { customFetch });
      sender.upsert({ waitUntil }, "users", { id: "u123", email: "alice@test.com", name: "Alice" });

      expect(waitUntil).toHaveBeenCalledTimes(1);
      expect(capturedPromise).not.null;

      await capturedPromise;

      expect(customFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledOptions] = customFetch.mock.calls[0];
      expect(calledUrl).toBe("https://nas-backup.com/api/sync");
      expect(calledOptions.method).toBe("POST");
      expect(calledOptions.headers["X-Sync-Secret"]).toBe("my_secret_token");

      const body = JSON.parse(calledOptions.body);
      expect(body.table).toBe("users");
      expect(body.action).toBe("UPSERT");
      expect(body.data.id).toBe("u123");
      expect(body.data.email).toBe("alice@test.com");
    });

    it("should gracefully handle fetch network errors without throwing", async () => {
      let capturedPromise: Promise<unknown> | null = null;
      const waitUntil = vi.fn((p: Promise<unknown>) => {
        capturedPromise = p;
      });

      const customFetch = vi.fn().mockRejectedValue(new Error("Network connection reset"));

      const env = {
        BACKUP_SYNC_ENDPOINT: "https://nas-backup.com/api/sync",
        BACKUP_SYNC_SECRET: "secret",
      };

      sendD1Change(
        { waitUntil },
        env,
        { table: "users", action: "DELETE", data: { id: "u123" } },
        { customFetch }
      );

      // Should resolve without throwing uncaught error
      await expect(capturedPromise).resolves.toBeUndefined();
    });
  });

  describe("handleD1SyncRequest (Receiver)", () => {
    function createMockDb() {
      const executed: Array<{ sql: string; bindings: unknown[] }> = [];
      return {
        executed,
        prepare: (sql: string) => ({
          bind: (...bindings: unknown[]) => ({
            run: vi.fn().mockImplementation(async () => {
              executed.push({ sql, bindings });
              return { success: true, meta: { changes: 1 } };
            }),
          }),
        }),
      };
    }

    it("should reject non-POST requests with 405", async () => {
      const env = { BACKUP_SYNC_SECRET: "sec123" };
      const req = new Request("http://localhost/api/sync", { method: "GET" });
      const res = await handleD1SyncRequest(req, env);

      expect(res.status).toBe(405);
    });

    it("should reject requests with invalid secret with 401", async () => {
      const env = { BACKUP_SYNC_SECRET: "correct_secret" };
      const req = new Request("http://localhost/api/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sync-Secret": "wrong_secret",
        },
        body: JSON.stringify({ table: "users", action: "UPSERT", data: { id: "1" } }),
      });

      const res = await handleD1SyncRequest(req, env);
      expect(res.status).toBe(401);
    });

    it("should process UPSERT and generate correct SQLite ON CONFLICT query", async () => {
      const mockDb = createMockDb();
      const env = { BACKUP_SYNC_SECRET: "secret_123" };

      const payload = {
        table: "users",
        action: "UPSERT",
        primaryKey: "id",
        data: {
          id: "u_abc",
          email: "user@example.com",
          email_verified: true,
          status: "active",
        },
      };

      const req = new Request("http://localhost/api/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sync-Secret": "secret_123",
        },
        body: JSON.stringify(payload),
      });

      const res = await handleD1SyncRequest(req, env, mockDb);
      expect(res.status).toBe(200);

      const json = (await res.json()) as { ok: boolean; synced: boolean };
      expect(json.ok).toBe(true);
      expect(json.synced).toBe(true);

      expect(mockDb.executed.length).toBe(1);
      const { sql, bindings } = mockDb.executed[0];

      expect(sql).toContain('INSERT INTO "users"');
      expect(sql).toContain('ON CONFLICT("id") DO UPDATE SET');
      expect(sql).toContain('"email" = excluded."email"');
      expect(sql).toContain('"status" = excluded."status"');
      expect(bindings).toEqual(["u_abc", "user@example.com", 1, "active"]);
    });

    it("should process DELETE and execute DELETE SQL", async () => {
      const mockDb = createMockDb();
      const env = { BACKUP_SYNC_SECRET: "secret_123" };

      const payload = {
        table: "passkeys",
        action: "DELETE",
        primaryKey: "id",
        data: {
          id: "pk_999",
        },
      };

      const req = new Request("http://localhost/api/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sync-Secret": "secret_123",
        },
        body: JSON.stringify(payload),
      });

      const res = await handleD1SyncRequest(req, env, mockDb);
      expect(res.status).toBe(200);

      expect(mockDb.executed.length).toBe(1);
      const { sql, bindings } = mockDb.executed[0];
      expect(sql).toBe('DELETE FROM "passkeys" WHERE "id" = ?;');
      expect(bindings).toEqual(["pk_999"]);
    });

    it("should process UPSERT with updated_at and generate LWW WHERE clause", async () => {
      const mockDb = createMockDb();
      const env = { PEER_SYNC_SECRET: "peer_secret" };

      const payload = {
        table: "users",
        action: "UPSERT" as const,
        primaryKey: "id",
        sourceNodeId: "nas-node-1",
        data: {
          id: "u_abc",
          email: "user@example.com",
          updated_at: 1700000000000,
        },
      };

      const req = new Request("http://localhost/api/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sync-Secret": "peer_secret",
          "X-Sync-Origin-Node": "nas-node-1",
        },
        body: JSON.stringify(payload),
      });

      const res = await handleD1SyncRequest(req, env, mockDb);
      expect(res.status).toBe(200);

      const json = (await res.json()) as { ok: boolean; synced: boolean; sourceNodeId?: string };
      expect(json.ok).toBe(true);
      expect(json.synced).toBe(true);
      expect(json.sourceNodeId).toBe("nas-node-1");

      expect(mockDb.executed.length).toBe(1);
      const { sql, bindings } = mockDb.executed[0];

      expect(sql).toContain('ON CONFLICT("id") DO UPDATE SET');
      expect(sql).toContain('WHERE excluded."updated_at" >= "users"."updated_at" OR "users"."updated_at" IS NULL');
      expect(bindings).toEqual(["u_abc", "user@example.com", 1700000000000]);
    });

    it("should reject malicious SQL injection table names with 400", async () => {
      const mockDb = createMockDb();
      const env = { BACKUP_SYNC_SECRET: "secret_123" };

      const payload = {
        table: "users; DROP TABLE users; --",
        action: "UPSERT",
        data: { id: "1" },
      };

      const req = new Request("http://localhost/api/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sync-Secret": "secret_123",
        },
        body: JSON.stringify(payload),
      });

      const res = await handleD1SyncRequest(req, env, mockDb);
      expect(res.status).toBe(400);
      expect(mockDb.executed.length).toBe(0);
    });
  });
});
