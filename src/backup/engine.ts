/**
 * @nuln/worker-kit/backup/engine
 *
 * D1 数据库流式导出、SHA-256 校验和计算与安全恢复引擎
 */

import { sha256Hex } from "../s3/sigv4.js";
import type {
  BackupBundle,
  TableBackupData,
  D1ExportOptions,
  D1RestoreOptions,
  RestoreSummary,
} from "./types.js";

const SYSTEM_TABLE_PREFIXES = ["sqlite_", "_cf_", "d1_", "drizzle_"];

/**
 * 导出 D1 数据库所有或指定业务表数据
 */
export async function exportD1Database(
  db: any,
  options: D1ExportOptions = {}
): Promise<BackupBundle> {
  const service = options.serviceName || "service";
  const now = Date.now();

  // 1. 发现所有物理数据表
  const masterQuery = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'";
  const tableRows = await db.prepare(masterQuery).all();
  const allTables: string[] = (tableRows?.results || [])
    .map((r: any) => String(r.name))
    .filter((name: string) => !SYSTEM_TABLE_PREFIXES.some((p) => name.startsWith(p)));

  // 2. 表白名单与黑名单过滤
  let targetTables = allTables;
  if (options.includeTables && options.includeTables.length > 0) {
    const incSet = new Set(options.includeTables);
    targetTables = targetTables.filter((t) => incSet.has(t));
  }
  if (options.excludeTables && options.excludeTables.length > 0) {
    const excSet = new Set(options.excludeTables);
    targetTables = targetTables.filter((t) => !excSet.has(t));
  }

  // 3. 读取各表完整数据
  const tables: Record<string, TableBackupData> = {};
  for (const tableName of targetTables) {
    try {
      const dataRes = await db.prepare(`SELECT * FROM "${tableName}"`).all();
      const rows: Record<string, any>[] = dataRes?.results || [];
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

      tables[tableName] = {
        name: tableName,
        rowCount: rows.length,
        columns,
        rows,
      };
    } catch (err: any) {
      console.warn(`[BackupEngine] Failed to dump table "${tableName}":`, err.message);
    }
  }

  // 4. 计算确定性 SHA-256 校验和
  const dataPayload = JSON.stringify(tables);
  const checksum = `sha256:${await sha256Hex(dataPayload)}`;

  return {
    version: 1,
    service,
    timestamp: now,
    createdAt: new Date(now).toISOString(),
    checksum,
    tables,
    metadata: options.metadata,
  };
}

/**
 * 将备份数据包安全恢复至 D1 数据库
 */
export async function restoreD1Database(
  db: any,
  bundle: BackupBundle,
  options: D1RestoreOptions = {}
): Promise<RestoreSummary> {
  const startTime = Date.now();
  const verifyChecksum = options.verifyChecksum ?? true;
  const truncate = options.truncateBeforeInsert ?? false;
  const conflictStrategy = options.conflictStrategy || "replace";

  if (!bundle || bundle.version !== 1 || !bundle.tables) {
    return {
      success: false,
      restoredTables: [],
      totalRowsInserted: 0,
      durationMs: Date.now() - startTime,
      error: "Invalid or unsupported backup bundle format",
    };
  }

  // 1. 校验 SHA-256 完整性
  if (verifyChecksum && bundle.checksum) {
    const dataPayload = JSON.stringify(bundle.tables);
    const expectedChecksum = `sha256:${await sha256Hex(dataPayload)}`;
    if (bundle.checksum !== expectedChecksum) {
      return {
        success: false,
        restoredTables: [],
        totalRowsInserted: 0,
        durationMs: Date.now() - startTime,
        error: `Checksum mismatch! Corrupted backup data (expected ${expectedChecksum}, got ${bundle.checksum})`,
      };
    }
  }

  const restoredTables: string[] = [];
  let totalRowsInserted = 0;

  let tablesToRestore = Object.keys(bundle.tables);
  if (options.includeTables && options.includeTables.length > 0) {
    const incSet = new Set(options.includeTables);
    tablesToRestore = tablesToRestore.filter((t) => incSet.has(t));
  }

  // 2. 逐表恢复数据
  for (const tableName of tablesToRestore) {
    const tableData = bundle.tables[tableName];
    if (!tableData || !Array.isArray(tableData.rows)) continue;

    try {
      // 可选清空已有数据
      if (truncate) {
        await db.prepare(`DELETE FROM "${tableName}"`).run();
      }

      if (tableData.rows.length === 0) {
        restoredTables.push(tableName);
        continue;
      }

      const insertVerb =
        conflictStrategy === "replace"
          ? "INSERT OR REPLACE INTO"
          : conflictStrategy === "ignore"
          ? "INSERT OR IGNORE INTO"
          : "INSERT INTO";

      // 分批写入 (每批 50 行，避免 D1 SQL 变量上限)
      const BATCH_SIZE = 50;
      for (let i = 0; i < tableData.rows.length; i += BATCH_SIZE) {
        const chunk = tableData.rows.slice(i, i + BATCH_SIZE);
        const stmts = chunk.map((row) => {
          const keys = Object.keys(row);
          const cols = keys.map((k) => `"${k}"`).join(", ");
          const placeholders = keys.map(() => "?").join(", ");
          const values = keys.map((k) => (row[k] === undefined ? null : row[k]));

          return db.prepare(`${insertVerb} "${tableName}" (${cols}) VALUES (${placeholders})`).bind(...values);
        });

        if (typeof db.batch === "function") {
          await db.batch(stmts);
        } else {
          for (const s of stmts) {
            await s.run();
          }
        }
        totalRowsInserted += chunk.length;
      }

      restoredTables.push(tableName);
    } catch (err: any) {
      console.error(`[BackupEngine] Failed to restore table "${tableName}":`, err);
      return {
        success: false,
        restoredTables,
        totalRowsInserted,
        durationMs: Date.now() - startTime,
        error: `Error restoring table "${tableName}": ${err.message}`,
      };
    }
  }

  return {
    success: true,
    restoredTables,
    totalRowsInserted,
    durationMs: Date.now() - startTime,
  };
}
