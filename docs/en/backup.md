# D1 Incremental Backup & One-Click Chain Restore

<p align="center">
  <a href="./backup.md">English</a> | <a href="../zh/backup.md">简体中文</a>
</p>

## Overview

The `@nuln/worker-kit/backup` module provides a high-performance, quota-efficient automated incremental backup and disaster recovery engine for Cloudflare D1 databases.

### Key Capabilities
- **Timestamp Watermark Tracking**: Tracks delta changes (`WHERE updated_at > ? OR created_at > ?`) automatically.
- **Zero-Change Optimization**: Skips S3 upload when 0 rows are modified, consuming 0 S3 write operations.
- **Constant Memory Footprint**: Uses cursor pagination (`LIMIT 1000`) to guarantee $\le 5\text{MB}$ memory consumption, preventing Worker 128MB OOM.
- **One-Click Chronological Chain Restore**: Automatically scans S3, topologically orders incremental bundles, verifies SHA-256 signatures, and replays deltas with Last-Write-Wins (LWW) idempotency.
- **Pre-Flight Dry-Run**: Preview affected tables and row counts before applying changes.

---

## API Reference

### 1. `performScheduledIncrementalBackup(options)`
Performs an automated scheduled incremental backup against D1 and pushes the delta package to S3/R2.

```ts
import { performScheduledIncrementalBackup } from "@nuln/worker-kit";

const result = await performScheduledIncrementalBackup({
  db: env.DB,
  serviceName: "mail",
  s3: {
    endpoint: env.S3_BACKUP_ENDPOINT,
    bucket: env.S3_BACKUP_BUCKET,
    accessKeyId: env.S3_BACKUP_ACCESS_KEY_ID,
    secretAccessKey: env.S3_BACKUP_SECRET_ACCESS_KEY,
  },
  staticTables: ["settings", "site_config"],
  skipZeroChanges: true,
  retentionDays: 30,
  maxBackups: 200,
});
```

### 2. `restoreIncrementalChainFromS3(options)`
Scans S3 for all incremental delta packages in chronological order and replays them into D1.

```ts
import { restoreIncrementalChainFromS3 } from "@nuln/worker-kit";

// Dry-Run Pre-flight Preview
const preview = await restoreIncrementalChainFromS3({
  db: env.DB,
  serviceName: "mail",
  s3: s3Config,
  dryRun: true,
});

// Full Disaster Recovery Replay
const result = await restoreIncrementalChainFromS3({
  db: env.DB,
  serviceName: "mail",
  s3: s3Config,
  dryRun: false,
  conflictStrategy: "replace",
});
```

### 3. `listIncrementalBackupsFromS3(options)`
Lists and sorts all incremental backup packages on S3.

---

## Example Usage

See [`examples/02-backup-example.ts`](../../examples/02-backup-example.ts) for a complete executable demonstration.
