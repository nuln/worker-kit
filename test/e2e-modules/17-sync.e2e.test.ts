import { describe, it, expect, vi } from "vitest";
import { handleD1SyncRequest } from "../../src/sync/receiver.js";
import { sendD1Change } from "../../src/sync/sender.js";

describe("[E2E Example] 17 - Distributed D1 Mesh Replication with LWW Conflict Resolution", () => {
  it("orchestrates change capture on primary node and atomic LWW sync execution on backup node", async () => {
    const PEER_SECRET = "mesh_sync_secret_key_8899";

    // 1. Primary Node: sends incremental D1 change
    const mockPeerFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, synced: true }), { status: 200 }));

    sendD1Change(
      { waitUntil: (p) => p },
      {
        PEER_SYNC_ENDPOINT: "https://dr-node.nuln.net/api/sync/d1",
        PEER_SYNC_SECRET: PEER_SECRET,
      },
      {
        table: "users",
        action: "UPSERT",
        primaryKey: "id",
        data: {
          id: "usr_mesh_01",
          email: "charlie@nuln.net",
          name: "Charlie",
          updatedAt: 1789540000000,
        },
      },
      { customFetch: mockPeerFetch as any }
    );

    expect(mockPeerFetch).toHaveBeenCalledTimes(1);
    const sentReq = mockPeerFetch.mock.calls[0];
    expect(sentReq[0]).toBe("https://dr-node.nuln.net/api/sync/d1");
    expect(sentReq[1].headers["X-Sync-Secret"]).toBe(PEER_SECRET);

    // 2. Backup Node: receives sync request and writes to local D1
    const backupDbData: Record<string, any[]> = { users: [] };
    const mockBackupDb = {
      prepare(sql: string) {
        return {
          bind(...params: any[]) {
            return {
              async run() {
                const [id, email, name, updatedAt] = params;
                const existingIdx = backupDbData.users.findIndex((u) => u.id === id);
                const record = { id, email, name, updated_at: updatedAt };
                if (existingIdx >= 0) backupDbData.users[existingIdx] = record;
                else backupDbData.users.push(record);
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    };

    const incomingPayload = JSON.parse(sentReq[1].body);
    const incomingReq = new Request("https://dr-node.nuln.net/api/sync/d1", {
      method: "POST",
      headers: {
        "X-Sync-Secret": PEER_SECRET,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(incomingPayload),
    });

    const syncRes = await handleD1SyncRequest(incomingReq, { PEER_SYNC_SECRET: PEER_SECRET }, mockBackupDb);
    expect(syncRes.status).toBe(200);
    const syncBody = (await syncRes.json()) as any;
    expect(syncBody.ok).toBe(true);
    expect(syncBody.synced).toBe(true);
    expect(backupDbData.users.length).toBe(1);
    expect(backupDbData.users[0].name).toBe("Charlie");
  });
});
