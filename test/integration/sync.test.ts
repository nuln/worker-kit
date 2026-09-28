import { describe, it, expect, vi } from "vitest";
import { sendD1Change, createD1SyncSender, handleD1SyncRequest } from "../../src/sync/index.js";

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
        // 关闭重试：本用例只关心"不抛异常"，重试会拖长耗时且与断言无关
        { customFetch, maxRetries: 0 }
      );

      // 意图是"不抛异常"：resolve 为投递结果对象是 KIT-BUG-02 新增的能力，
      // 故断言 resolve 为「一个结果对象」而不是 undefined。
      await expect(capturedPromise).resolves.toMatchObject({ success: false, attempts: 1 });
    });

    it("网络异常时不抛错，并把投递结果交给 onResult（KIT-BUG-02）", async () => {
      const customFetch = vi.fn().mockRejectedValue(new Error("Network connection reset"));
      const onResult = vi.fn();
      let captured: Promise<unknown> | null = null;

      sendD1Change(
        { waitUntil: (p) => { captured = p; } },
        { BACKUP_SYNC_ENDPOINT: "https://nas/api/sync", BACKUP_SYNC_SECRET: "s" },
        { table: "users", action: "DELETE", data: { id: "u123" } },
        { customFetch, maxRetries: 0, onResult }
      );

      await captured;
      expect(onResult).toHaveBeenCalledTimes(1);
      const r = onResult.mock.calls[0]![0] as {
        success: boolean;
        attempts: number;
        error?: string;
        retryable?: boolean;
      };
      expect(r.success).toBe(false);
      expect(r.attempts).toBe(1);
      expect(r.error).toContain("Network connection reset");
      // 网络异常属瞬时故障 → 值得重试
      expect(r.retryable).toBe(true);
    });
  });

  describe("handleD1SyncRequest (Receiver)", () => {
    /**
     * 可控的 D1 替身。
     *
     * 必须支持 `all()`：接收端用 `PRAGMA table_info` 探测本地表是否有
     * `updated_at` 列，据此决定是否施加 LWW 守卫。早期替身只有
     * `prepare().bind().run()`，探测抛错后被 catch 成 false，
     * 于是守卫被跳过 —— 而测试仍断言 SQL 里**应该有**守卫，
     * 两者只能靠"表恰好没有 updated_at 列"这种巧合同时成立。
     *
     * @param opts.hasUpdatedAt 本地表是否有 `updated_at` 列（默认有）
     */
    function createMockDb(opts: { hasUpdatedAt?: boolean } = {}) {
      const hasUpdatedAt = opts.hasUpdatedAt ?? true;
      const executed: Array<{ sql: string; bindings: unknown[] }> = [];
      return {
        executed,
        prepare: (sql: string) => {
          const stmt = {
            bind: (...bindings: unknown[]) => ({
              run: vi.fn().mockImplementation(async () => {
                executed.push({ sql, bindings });
                return { success: true, meta: { changes: 1 } };
              }),
              all: vi.fn().mockImplementation(async () => {
                executed.push({ sql, bindings });
                return { results: [] };
              }),
            }),
            // PRAGMA 探测走这里（不经 bind）
            all: vi.fn().mockImplementation(async () => {
              if (/PRAGMA|table_info/i.test(sql)) {
                return { results: hasUpdatedAt ? [{ name: "updated_at" }] : [{ name: "id" }] };
              }
              return { results: [] };
            }),
            run: vi.fn().mockImplementation(async () => {
              executed.push({ sql, bindings: [] });
              return { success: true, meta: { changes: 1 } };
            }),
          };
          return stmt;
        },
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
      // 本地表**无** updated_at 列 → 走无 LWW 的兼容分支，允许载荷不带该字段。
      // （本地表**有**该列时，载荷必须携带它，否则接收端按 fail-closed 拒收 ——
      //   见下方 "本地表有 updated_at 但载荷未携带" 用例）
      const mockDb = createMockDb({ hasUpdatedAt: false });
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
