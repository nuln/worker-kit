/**
 * @nuln/worker-kit/backup/s3-backup
 *
 * 一站式定时 S3 备份与生命周期轮转清理执行器
 */

import { S3Client } from "../s3/client.js";
import { exportD1Database } from "./engine.js";
import type { ScheduledS3BackupOptions, ScheduledS3BackupResult } from "./types.js";

/**
 * 执行一站式 D1 数据库 S3 备份及历史文件轮转清理
 *
 * 适用于 Cloudflare Workers 的 Scheduled Event (Cron Triggers)
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

  // 1. 导出 D1 数据库为标准 Bundle
  const bundle = await exportD1Database(db, {
    serviceName,
    ...options.exportOptions,
  });

  const payload = JSON.stringify(bundle, null, 2);
  const bundleSize = new TextEncoder().encode(payload).byteLength;

  // 2. 生成带时间戳的标准备份路径
  const dateStr = new Date(bundle.timestamp).toISOString().split("T")[0];
  const targetKey = `${prefix}${serviceName}/${dateStr}_${bundle.timestamp}_${serviceName}.json`;

  // 3. 上传到远端 S3 存储桶
  await s3Client.putObject(targetKey, payload, {
    contentType: "application/json",
    metadata: {
      service: serviceName,
      timestamp: String(bundle.timestamp),
      checksum: bundle.checksum,
    },
  });

  // 4. 执行生命周期保留策略 (Retention Policy)
  const deletedKeys: string[] = [];
  try {
    const listRes = await s3Client.listObjects({
      prefix: `${prefix}${serviceName}/`,
    });

    const now = Date.now();
    const cutoffMs = retentionDays > 0 ? now - retentionDays * 24 * 60 * 60 * 1000 : 0;
    const existingObjects = listRes.objects.filter((obj) => obj.key !== targetKey);

    // 4.1 按保留天数清理过期文件
    const survivingObjects: typeof existingObjects = [];
    for (const obj of existingObjects) {
      let fileTimestamp = 0;
      // 从文件名中提取时间戳 (如 2026-09-17_1789540000000_mail.json)
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

    // 4.2 按最大保留数量清理最旧多余文件
    if (maxBackups > 0 && survivingObjects.length + 1 > maxBackups) {
      const excessCount = survivingObjects.length + 1 - maxBackups;
      // 按文件名/时间由旧到新排序
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
