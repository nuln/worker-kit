/**
 * Example 17: Distributed Multi-Node D1 Incremental Sync
 *
 * Demonstrates:
 * 1. Non-blocking asynchronous event dispatching via waitUntil (Cloudflare Workers -> NAS/Peer)
 * 2. Receiving and applying incremental sync payloads with Last-Write-Wins (LWW) conflict resolution
 * 3. Handling batch Upserts and Deletes
 */

import {
  createD1SyncSender,
  handleD1SyncRequest,
  type SyncEnv,
} from "@nuln/worker-kit";

export async function runSyncExample(ctx: any, env: SyncEnv) {
  console.log("=== [Example 17] Multi-Node Incremental Sync ===");

  // 1. Sender (on primary node): non-blocking push
  const sender = createD1SyncSender(env);
  sender.upsert(ctx, "users", {
    id: "usr_super_01",
    email: "admin@nuln.net",
    role: "superadmin",
    updated_at: Date.now(),
  });

  // 2. Receiver (on backup/peer node): LWW conflict resolution
  const incomingSyncRequest = new Request("https://backup.nuln.net/api/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sync-Secret": "backup_sync_secret",
      "X-Sync-Origin-Node": "cf-primary",
    },
    body: JSON.stringify({
      table: "users",
      action: "UPSERT",
      primaryKey: "id",
      timestamp: Date.now(),
      data: { id: "usr_super_01", email: "admin@nuln.net", role: "superadmin" },
    }),
  });

  // const syncResponse = await handleD1SyncRequest(incomingSyncRequest, env, ["users", "passkeys"]);
  // console.log("Sync receive status:", syncResponse.status);
}
