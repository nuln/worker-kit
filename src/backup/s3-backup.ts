/**
 * @nuln/worker-kit/backup/s3-backup
 *
 * 一站式定时 S3 增量备份、水位线跟踪与自动化增量链极简恢复引擎
 */

import { S3Client } from "../s3/client.js";
import type { S3ClientConfig } from "../s3/types.js";
import { exportD1Database, exportD1Incremental, restoreD1Database } from "./engine.js";
import type {
  ScheduledS3BackupOptions,
  ScheduledS3BackupResult,
  ScheduledIncrementalBackupOptions,
  ScheduledIncrementalBackupResult,
  WatermarkState,
  S3BackupFileSummary,
  IncrementalRestoreOptions,
  IncrementalRestoreResult,
  IncrementalBackupBundle,
} from "./types.js";

/**
 * 执行定时 S3 纯增量备份（自动维护 S3 水位线与零变动极速跳过）
 */
export async function performScheduledIncrementalBackup(
  options: ScheduledIncrementalBackupOptions
): Promise<ScheduledIncrementalBackupResult> {
  const startTime = Date.now();
  const { db, serviceName, s3: s3Config } = options;
  const prefix = (options.keyPrefix || "backups/").replace(/\/+$/, "") + "/";
  const skipZeroChanges = options.skipZeroChanges ?? true;
  const retentionDays = options.retentionDays ?? 30;
  const maxBackups = options.maxBackups ?? 200;

  const s3Client = new S3Client(s3Config);
  const watermarkKey = `${prefix}${serviceName}/latest_watermark.json`;

  // 1. 获取增量起始水位线
  let sinceTimestamp = options.sinceTimestamp;
  if (sinceTimestamp === undefined) {
    try {
      const watermarkObj = await s3Client.getObject(watermarkKey);
      if (watermarkObj) {
        const text = await watermarkObj.text();
        const state: WatermarkState = JSON.parse(text);
        if (state && typeof state.lastWatermark === "number") {
          sinceTimestamp = state.lastWatermark;
        }
      }
    } catch {
      // 首次备份无 watermark 文件，默认从 0 开始
      sinceTimestamp = 0;
    }
  }
  if (sinceTimestamp === undefined) {
    sinceTimestamp = 0;
  }

  const untilTimestamp = Date.now();

  // 2. 抽取 D1 增量数据
  const bundle = await exportD1Incremental(db, {
    serviceName,
    sinceTimestamp,
    untilTimestamp,
    staticTables: options.staticTables,
    includeTables: options.includeTables,
    excludeTables: options.excludeTables,
  });

  // 3. 零变动跳过优化 (在非首次且 0 变动时直接跳过上传)
  if (sinceTimestamp > 0 && bundle.totalChangedRows === 0 && skipZeroChanges) {
    return {
      success: true,
      skipped: true,
      bundleSize: 0,
      totalChangedRows: 0,
      sinceTimestamp,
      untilTimestamp,
      deletedKeys: [],
      durationMs: Date.now() - startTime,
    };
  }

  const payload = JSON.stringify(bundle, null, 2);
  const bundleSize = new TextEncoder().encode(payload).byteLength;

  // 4. 生成规范化增量存储 Key
  const dateStr = new Date(bundle.timestamp).toISOString().split("T")[0];
  const targetKey = `${prefix}${serviceName}/inc/${dateStr}/${bundle.timestamp}_since_${sinceTimestamp}_${serviceName}.json`;

  // 5. 上传增量包至 S3
  await s3Client.putObject(targetKey, payload, {
    contentType: "application/json",
    metadata: {
      service: serviceName,
      type: "incremental",
      since: String(sinceTimestamp),
      until: String(untilTimestamp),
      rows: String(bundle.totalChangedRows),
      checksum: bundle.checksum,
    },
  });

  // 6. 更新并持久化最新水位线
  const newWatermarkState: WatermarkState = {
    service: serviceName,
    lastWatermark: untilTimestamp,
    lastBackupKey: targetKey,
    lastBackupTime: new Date(untilTimestamp).toISOString(),
    totalChangedRows: bundle.totalChangedRows,
    checksum: bundle.checksum,
  };
  await s3Client.putObject(watermarkKey, JSON.stringify(newWatermarkState, null, 2), {
    contentType: "application/json",
  });

  // 7. 增量历史文件生命周期清理
  const deletedKeys: string[] = [];
  try {
    const listRes = await s3Client.listObjects({
      prefix: `${prefix}${serviceName}/inc/`,
    });

    const now = Date.now();
    const cutoffMs = retentionDays > 0 ? now - retentionDays * 24 * 60 * 60 * 1000 : 0;
    const existingObjects = listRes.objects.filter((obj) => obj.key !== targetKey);

    const survivingObjects: typeof existingObjects = [];
    for (const obj of existingObjects) {
      let fileTimestamp = 0;
      const tsMatch = obj.key.match(/\/(\d{10,13})_since_/);
      if (tsMatch) {
        fileTimestamp = parseInt(tsMatch[1], 10);
      } else if (obj.lastModified) {
        fileTimestamp = new Date(obj.lastModified).getTime();
      }

      if (cutoffMs > 0 && fileTimestamp > 0 && fileTimestamp < cutoffMs) {
        await s3Client.deleteObject(obj.key);
        deletedKeys.push(obj.key);
      } else {
        survivingObjects.push(obj);
      }
    }

    if (maxBackups > 0 && survivingObjects.length + 1 > maxBackups) {
      const excessCount = survivingObjects.length + 1 - maxBackups;
      survivingObjects.sort((a, b) => a.key.localeCompare(b.key));
      const toDelete = survivingObjects.slice(0, excessCount);
      for (const item of toDelete) {
        await s3Client.deleteObject(item.key);
        deletedKeys.push(item.key);
      }
    }
  } catch (err: any) {
    console.warn(`[BackupS3] Incremental retention cleanup warning for "${serviceName}":`, err.message);
  }

  return {
    success: true,
    skipped: false,
    uploadedKey: targetKey,
    bundleSize,
    totalChangedRows: bundle.totalChangedRows,
    sinceTimestamp,
    untilTimestamp,
    checksum: bundle.checksum,
    deletedKeys,
    durationMs: Date.now() - startTime,
  };
}

/**
 * 列出 S3 上指定微服务的所有增量备份记录并按时间排序
 */
export async function listIncrementalBackupsFromS3(options: {
  s3: S3ClientConfig;
  serviceName: string;
  keyPrefix?: string;
}): Promise<S3BackupFileSummary[]> {
  const { serviceName, s3: s3Config } = options;
  const prefix = (options.keyPrefix || "backups/").replace(/\/+$/, "") + "/";
  const s3Client = new S3Client(s3Config);

  const listRes = await s3Client.listObjects({
    prefix: `${prefix}${serviceName}/`,
  });

  const summaries: S3BackupFileSummary[] = [];

  for (const obj of listRes.objects) {
    if (!obj.key.endsWith(".json") || obj.key.endsWith("latest_watermark.json")) continue;

    let untilTimestamp = 0;
    let sinceTimestamp = 0;
    const isIncremental = obj.key.includes("_since_");

    if (isIncremental) {
      const match = obj.key.match(/(\d{10,13})_since_(\d+)_/);
      if (match) {
        untilTimestamp = parseInt(match[1], 10);
        sinceTimestamp = parseInt(match[2], 10);
      }
    } else {
      const match = obj.key.match(/_(\d{10,13})_/);
      if (match) {
        untilTimestamp = parseInt(match[1], 10);
      }
    }

    if (untilTimestamp === 0 && obj.lastModified) {
      untilTimestamp = new Date(obj.lastModified).getTime();
    }

    summaries.push({
      key: obj.key,
      size: obj.size,
      lastModified: obj.lastModified,
      service: serviceName,
      sinceTimestamp,
      untilTimestamp,
      isIncremental,
    });
  }

  // 按时间升序排序 (从旧到新)
  summaries.sort((a, b) => a.untilTimestamp - b.untilTimestamp);
  return summaries;
}

/**
 * 极简一键增量链恢复引擎（自动发现、拓扑排序、SHA-256 校验与 LWW 幂等重放）
 */
export async function restoreIncrementalChainFromS3(
  options: IncrementalRestoreOptions
): Promise<IncrementalRestoreResult> {
  const startTime = Date.now();
  const { db, serviceName, s3: s3Config } = options;
  const untilTimestamp = options.untilTimestamp ?? Date.now();
  const sinceTimestamp = options.sinceTimestamp ?? 0;
  const dryRun = options.dryRun ?? false;
  const conflictStrategy = options.conflictStrategy || "replace";

  const s3Client = new S3Client(s3Config);

  // 1. 检索 S3 上的所有备份条目
  const allBackups = await listIncrementalBackupsFromS3({
    s3: s3Config,
    serviceName,
    keyPrefix: options.keyPrefix,
  });

  // 2. 筛选在 [sinceTimestamp, untilTimestamp] 范围内的增量文件并按时间正序排列
  const targetChain = allBackups.filter(
    (b) => b.untilTimestamp <= untilTimestamp && (b.sinceTimestamp ?? 0) >= sinceTimestamp
  );

  if (targetChain.length === 0) {
    return {
      success: true,
      dryRun,
      appliedBundlesCount: 0,
      appliedBundleKeys: [],
      restoredTables: [],
      totalRowsAffected: 0,
      durationMs: Date.now() - startTime,
      bundleReports: [],
      error: "No matching incremental backup bundles found in target timeframe",
    };
  }

  const appliedBundleKeys: string[] = [];
  const affectedTablesSet = new Set<string>();
  let totalRowsAffected = 0;
  const bundleReports: IncrementalRestoreResult["bundleReports"] = [];

  // 3. 链式依次下载、校验并重放增量包
  for (const item of targetChain) {
    const bundleStart = Date.now();
    try {
      const s3Obj = await s3Client.getObject(item.key);
      if (!s3Obj) {
        throw new Error(`S3 object not found for key: ${item.key}`);
      }

      const text = await s3Obj.text();
      const bundle: IncrementalBackupBundle = JSON.parse(text);

      let bundleRows = 0;
      for (const [tbl, data] of Object.entries(bundle.tables || {})) {
        if (!options.includeTables || options.includeTables.includes(tbl)) {
          affectedTablesSet.add(tbl);
          bundleRows += data.rowCount || (data.rows ? data.rows.length : 0);
        }
      }

      // 如果非 Dry-Run 则真正写入 D1 数据库
      if (!dryRun) {
        const restoreRes = await restoreD1Database(db, bundle, {
          verifyChecksum: true,
          conflictStrategy,
          includeTables: options.includeTables,
        });

        if (!restoreRes.success) {
          return {
            success: false,
            dryRun,
            appliedBundlesCount: appliedBundleKeys.length,
            appliedBundleKeys,
            restoredTables: Array.from(affectedTablesSet),
            totalRowsAffected,
            durationMs: Date.now() - startTime,
            bundleReports,
            error: `Failed to apply bundle ${item.key}: ${restoreRes.error}`,
          };
        }
      }

      appliedBundleKeys.push(item.key);
      totalRowsAffected += bundleRows;
      bundleReports.push({
        key: item.key,
        sinceTimestamp: item.sinceTimestamp,
        untilTimestamp: item.untilTimestamp,
        rowCount: bundleRows,
        durationMs: Date.now() - bundleStart,
      });
    } catch (err: any) {
      return {
        success: false,
        dryRun,
        appliedBundlesCount: appliedBundleKeys.length,
        appliedBundleKeys,
        restoredTables: Array.from(affectedTablesSet),
        totalRowsAffected,
        durationMs: Date.now() - startTime,
        bundleReports,
        error: `Error processing bundle ${item.key}: ${err.message}`,
      };
    }
  }

  return {
    success: true,
    dryRun,
    appliedBundlesCount: appliedBundleKeys.length,
    appliedBundleKeys,
    restoredTables: Array.from(affectedTablesSet),
    totalRowsAffected,
    durationMs: Date.now() - startTime,
    bundleReports,
  };
}

/**
 * 执行一站式 D1 数据库 S3 全量备份及历史文件轮转清理（兼容接口）
 */
export async function performScheduledS3Backup(
  options: ScheduledS3BackupOptions
): Promise<ScheduledS3BackupResult> {
  const startTime = Date.now();
  const { db, serviceName, s3: s3Config } = options;
  const prefix = (options.keyPrefix || "backups/").replace(/\/+$/, "") + "/";
  const retentionDays = options.retentionDays ?? 30;
  const maxBackups = options.maxBackups ?? 100;

  const s3Client = new S3Client(s3Config);

  const bundle = await exportD1Database(db, {
    serviceName,
    ...options.exportOptions,
  });

  const payload = JSON.stringify(bundle, null, 2);
  const bundleSize = new TextEncoder().encode(payload).byteLength;

  const dateStr = new Date(bundle.timestamp).toISOString().split("T")[0];
  const targetKey = `${prefix}${serviceName}/full/${dateStr}_${bundle.timestamp}_${serviceName}.json`;

  await s3Client.putObject(targetKey, payload, {
    contentType: "application/json",
    metadata: {
      service: serviceName,
      timestamp: String(bundle.timestamp),
      checksum: bundle.checksum,
    },
  });

  const deletedKeys: string[] = [];
  try {
    const listRes = await s3Client.listObjects({
      prefix: `${prefix}${serviceName}/full/`,
    });

    const now = Date.now();
    const cutoffMs = retentionDays > 0 ? now - retentionDays * 24 * 60 * 60 * 1000 : 0;
    const existingObjects = listRes.objects.filter((obj) => obj.key !== targetKey);

    const survivingObjects: typeof existingObjects = [];
    for (const obj of existingObjects) {
      let fileTimestamp = 0;
      const tsMatch = obj.key.match(/_(\d{10,13})_/);
      if (tsMatch) {
        fileTimestamp = parseInt(tsMatch[1], 10);
      } else if (obj.lastModified) {
        fileTimestamp = new Date(obj.lastModified).getTime();
      }

      if (cutoffMs > 0 && fileTimestamp > 0 && fileTimestamp < cutoffMs) {
        await s3Client.deleteObject(obj.key);
        deletedKeys.push(obj.key);
      } else {
        survivingObjects.push(obj);
      }
    }

    if (maxBackups > 0 && survivingObjects.length + 1 > maxBackups) {
      const excessCount = survivingObjects.length + 1 - maxBackups;
      survivingObjects.sort((a, b) => a.key.localeCompare(b.key));
      const toDelete = survivingObjects.slice(0, excessCount);
      for (const item of toDelete) {
        await s3Client.deleteObject(item.key);
        deletedKeys.push(item.key);
      }
    }
  } catch (err: any) {
    console.warn(`[BackupS3] Retention cleanup error for "${serviceName}":`, err.message);
  }

  return {
    success: true,
    uploadedKey: targetKey,
    bundleSize,
    checksum: bundle.checksum,
    deletedKeys,
    durationMs: Date.now() - startTime,
  };
}

