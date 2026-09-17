/**
 * Example 02: D1 Database Automated Incremental Backup & Chain Restore
 *
 * Demonstrates:
 * 1. Performing automated scheduled incremental backups with S3 watermark tracking
 * 2. Zero-change optimization (skips S3 upload when 0 rows modified)
 * 3. Dry-run inspection and one-click chronological incremental chain disaster recovery
 */

import {
  performScheduledIncrementalBackup,
  restoreIncrementalChainFromS3,
  listIncrementalBackupsFromS3,
} from "@nuln/worker-kit";

export async function runBackupExample(env: any) {
  console.log("=== [Example 02] D1 Incremental Backup & One-Click Chain Restore ===");

  const s3Config = {
    endpoint: env.S3_BACKUP_ENDPOINT || "https://<account_id>.r2.cloudflarestorage.com",
    region: env.S3_BACKUP_REGION || "auto",
    bucket: env.S3_BACKUP_BUCKET || "nuln-backups",
    accessKeyId: env.S3_BACKUP_ACCESS_KEY_ID || "mock_key_id",
    secretAccessKey: env.S3_BACKUP_SECRET_ACCESS_KEY || "mock_secret_key",
  };

  // 1. Perform automated scheduled incremental backup
  console.log("[Backup] Executing scheduled incremental backup for 'mail' service...");
  const backupResult = await performScheduledIncrementalBackup({
    db: env.DB,
    serviceName: "mail",
    s3: s3Config,
    staticTables: ["settings", "site_config"],
    skipZeroChanges: true,
    retentionDays: 30,
    maxBackups: 200,
  });

  if (backupResult.skipped) {
    console.log("[Backup] 0 rows changed, skipped S3 upload to conserve bandwidth & quota.");
  } else {
    console.log(`[Backup] Uploaded delta package: ${backupResult.uploadedKey}`);
    console.log(`[Backup] Rows changed: ${backupResult.totalChangedRows}, Size: ${backupResult.bundleSize} bytes`);
  }

  // 2. Query available incremental history
  console.log("[Restore] Scanning S3 incremental delta chain...");
  const history = await listIncrementalBackupsFromS3({
    s3: s3Config,
    serviceName: "mail",
  });
  console.log(`[Restore] Found ${history.length} incremental packages on S3.`);

  // 3. Dry-Run pre-flight check before disaster recovery
  console.log("[Restore] Running Dry-Run pre-flight check...");
  const dryRunReport = await restoreIncrementalChainFromS3({
    db: env.DB,
    serviceName: "mail",
    s3: s3Config,
    dryRun: true,
  });
  console.log(`[Restore] Dry-Run preview: ${dryRunReport.totalRowsAffected} rows across tables [${dryRunReport.restoredTables.join(", ")}]`);

  // 4. One-Click disaster recovery execution (Last-Write-Wins replay)
  console.log("[Restore] Executing one-click incremental chain restore...");
  const restoreReport = await restoreIncrementalChainFromS3({
    db: env.DB,
    serviceName: "mail",
    s3: s3Config,
    dryRun: false,
    conflictStrategy: "replace",
  });

  if (restoreReport.success) {
    console.log(`[Restore] Disaster recovery completed in ${restoreReport.durationMs}ms!`);
    console.log(`[Restore] Applied ${restoreReport.appliedBundlesCount} bundles, restored ${restoreReport.totalRowsAffected} total rows.`);
  } else {
    console.error(`[Restore] Disaster recovery failed: ${restoreReport.error}`);
  }
}

