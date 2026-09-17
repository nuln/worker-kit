import { describe, it, expect, vi } from "vitest";
import { handleD1SyncRequest } from "../src/sync/receiver.js";
import { sendD1Change } from "../src/sync/sender.js";

describe("@nuln/worker-kit/sync - Deep Sync Receiver & Sender Coverage", () => {
  it("handleD1SyncRequest rejects non-POST and invalid secret", async () => {
    const getReq = new Request("http://localhost/sync", { method: "GET" });
    const resGet = await handleD1SyncRequest(getReq, { PEER_SYNC_SECRET: "secret123" });
    expect(resGet.status).toBe(405);

    const badSecretReq = new Request("http://localhost/sync", {
      method: "POST",
      headers: { "X-Sync-Secret": "wrong" },
      body: "{}",
    });
    const resBadSecret = await handleD1SyncRequest(badSecretReq, { PEER_SYNC_SECRET: "secret123" });
    expect(resBadSecret.status).toBe(401);
  });

  it("handleD1SyncRequest handles malformed json and invalid identifiers", async () => {
    const env = { PEER_SYNC_SECRET: "secret123" };
    const badJsonReq = new Request("http://localhost/sync", {
      method: "POST",
      headers: { "X-Sync-Secret": "secret123" },
      body: "not-json",
    });
    const resBadJson = await handleD1SyncRequest(badJsonReq, env);
    expect(resBadJson.status).toBe(400);

    const badTableReq = new Request("http://localhost/sync", {
      method: "POST",
      headers: { "X-Sync-Secret": "secret123" },
      body: JSON.stringify({ table: "users; DROP TABLE users;", data: { id: "1" } }),
    });
    const resBadTable = await handleD1SyncRequest(badTableReq, env);
    expect(resBadTable.status).toBe(400);

    const emptyDataReq = new Request("http://localhost/sync", {
      method: "POST",
      headers: { "X-Sync-Secret": "secret123" },
      body: JSON.stringify({ table: "users", data: {} }),
    });
    const mockDb = { prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ run: vi.fn() }) }) };
    const resEmptyData = await handleD1SyncRequest(emptyDataReq, env, mockDb);
    expect(resEmptyData.status).toBe(400);
  });

  it("handleD1SyncRequest handles DELETE and UPSERT with LWW and DB errors", async () => {
    const env = { PEER_SYNC_SECRET: "secret123" };
    const runSpy = vi.fn().mockResolvedValue({ success: true });
    const mockDb = {
      prepare: vi.fn().mockImplementation((sql: string) => {
        return {
          bind: vi.fn().mockReturnValue({
            run: runSpy,
          }),
        };
      }),
    };

    // 1. DELETE without PK value -> 400
    const delReqNoPk = new Request("http://localhost/sync", {
      method: "POST",
      headers: { "X-Sync-Secret": "secret123" },
      body: JSON.stringify({ table: "users", action: "DELETE", data: {} }),
    });
    const resDelNoPk = await handleD1SyncRequest(delReqNoPk, env, mockDb);
    expect(resDelNoPk.status).toBe(400);

    // 2. DELETE with PK value -> 200
    const delReq = new Request("http://localhost/sync", {
      method: "POST",
      headers: { "X-Sync-Secret": "secret123" },
      body: JSON.stringify({ table: "users", action: "DELETE", primaryKey: "id", data: { id: "u_del" } }),
    });
    const resDel = await handleD1SyncRequest(delReq, env, mockDb);
    expect(resDel.status).toBe(200);

    // 3. UPSERT with only primary key -> DO NOTHING
    const upsertPkOnly = new Request("http://localhost/sync", {
      method: "POST",
      headers: { "X-Sync-Secret": "secret123" },
      body: JSON.stringify({ table: "roles", data: { id: "admin" } }),
    });
    const resUpsertPk = await handleD1SyncRequest(upsertPkOnly, env, mockDb);
    expect(resUpsertPk.status).toBe(200);

    // 4. UPSERT with updated_at -> LWW Clause
    const makeUpsertReq = () =>
      new Request("http://localhost/sync", {
        method: "POST",
        headers: { "X-Sync-Secret": "secret123", "X-Sync-Origin-Node": "worker-main" },
        body: JSON.stringify({
          table: "users",
          data: { id: "u1", name: "Alice", updatedAt: new Date(), isActive: true, meta: { role: "admin" } },
        }),
      });

    const resUpsert = await handleD1SyncRequest(makeUpsertReq(), env, mockDb);
    expect(resUpsert.status).toBe(200);

    // 5. DB failure -> 500
    const brokenDb = {
      prepare: vi.fn().mockImplementation(() => {
        throw new Error("Disk full");
      }),
    };
    const resFail = await handleD1SyncRequest(makeUpsertReq(), env, brokenDb);
    expect(resFail.status).toBe(500);

    // 6. Missing DB -> 500
    const resNoDb = await handleD1SyncRequest(makeUpsertReq(), { PEER_SYNC_SECRET: "secret123" });
    expect(resNoDb.status).toBe(500);
  });
});
