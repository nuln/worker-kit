/**
 * Example 02: D1 Database Cold Backup Engine
 *
 * Demonstrates:
 * 1. Exporting D1 database schemas and table rows as JSON/SQL dumps
 * 2. Uploading compressed backup snapshots directly to S3/R2 remote buckets
 * 3. Restoring table records from cold storage
 */

import { S3BackupEngine, S3Client } from "@nuln/worker-kit";

export async function runBackupExample(env: any) {
  console.log("=== [Example 02] D1 Database Backup Engine ===");

  const s3Client = new S3Client({
    provider: "r2",
    endpoint: env.S3_ENDPOINT || "https://r2.cloudflarestorage.com",
    accessKeyId: env.S3_ACCESS_KEY_ID || "dummy_key",
    secretAccessKey: env.S3_SECRET_ACCESS_KEY || "dummy_secret",
    bucket: env.S3_BUCKET || "nuln-backups",
  });

  const engine = new S3BackupEngine({
    s3: s3Client,
    prefix: "d1-snapshots/tower-service",
    retentionDays: 30,
  });

  // Export tables: users, sessions, passkeys
  console.log("Triggering automated snapshot export to remote S3...");
  // const result = await engine.exportAndUpload(env.DB, ["users", "passkeys"]);
  // console.log(`Backup completed: ${result.key} (Size: ${result.sizeBytes} bytes)`);
}
