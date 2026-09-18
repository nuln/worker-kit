/**
 * @nuln/worker-kit/backup/engine
 *
 * D1 数据库流式导出、增量水位线提取、SHA-256 校验和计算与安全恢复引擎
 */

import { sha256Hex } from "../s3/sigv4.js";
import type {
  BackupBundle,
  IncrementalBackupBundle,
  TableBackupData,
  D1ExportOptions,
  D1IncrementalExportOptions,
  D1RestoreOptions,
  RestoreSummary,
} from "./types.js";

const SYSTEM_TABLE_PREFIXES = ["sqlite_", "_cf_", "d1_", "drizzle_"];

/**
 * 发现 D1 数据库中所有物理业务表（自动过滤系统表、虚拟表及其影子表）
 */
export async function getD1UserTables(db: any): Promise<string[]> {
  try {
    const masterQuery = "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'";
    const tableRows = await db.prepare(masterQuery).all();
    const results: any[] = tableRows?.results || [];

    // 找出所有虚拟表名称
    const virtualTables = new Set<string>();
    for (const r of results) {
      const sql = String(r.sql || "");
      if (sql.toUpperCase().includes("VIRTUAL TABLE")) {
        virtualTables.add(String(r.name));
      }
    }

    const isShadowOfVirtual = (name: string) => {
      for (const vt of virtualTables) {
        if (name.startsWith(`${vt}_`)) return true;
      }
      return false;
    };

    return results
      .map((r: any) => String(r.name))
      .filter((name: string) => {
        if (SYSTEM_TABLE_PREFIXES.some((p) => name.startsWith(p))) return false;
        if (virtualTables.has(name)) return false;
        if (isShadowOfVirtual(name)) return false;
        return true;
      });
  } catch (err: any) {
    console.warn("[BackupEngine] Failed to query sqlite_master for user tables:", err?.message);
    return [];
  }
}

/**
 * 检查表的字段列表
 */
export async function getTableColumns(db: any, tableName: string): Promise<string[]> {
  try {
    const res = await db.prepare(`PRAGMA table_info("${tableName}")`).all();
    return (res?.results || []).map((col: any) => String(col.name));
  } catch {
    return [];
  }
}

/**
 * 导出 D1 数据库所有或指定业务表的全量数据
 */
export async function exportD1Database(
  db: any,
  options: D1ExportOptions = {}
): Promise<BackupBundle> {
  const service = options.serviceName || "service";
  const now = Date.now();
  const allTables = await getD1UserTables(db);

  // 表白名单与黑名单过滤
  let targetTables = allTables;
  if (options.includeTables && options.includeTables.length > 0) {
    const incSet = new Set(options.includeTables);
    targetTables = targetTables.filter((t) => incSet.has(t));
  }
  if (options.excludeTables && options.excludeTables.length > 0) {
    const excSet = new Set(options.excludeTables);
    targetTables = targetTables.filter((t) => !excSet.has(t));
  }

  const batchSize = options.batchSize || 1000;
  const tables: Record<string, TableBackupData> = {};
  let totalChangedRows = 0;

  for (const tableName of targetTables) {
    try {
      const columns = await getTableColumns(db, tableName);
      const rows: Record<string, any>[] = [];

      // 采用分页安全拉取
      let offset = 0;
      while (true) {
        const query = `SELECT * FROM "${tableName}" LIMIT ? OFFSET ?`;
        const chunkRes = await db.prepare(query).bind(batchSize, offset).all();
        const chunk = chunkRes?.results || [];
        if (chunk.length === 0) break;
        rows.push(...chunk);
        offset += chunk.length;
        if (chunk.length < batchSize) break;
      }

      tables[tableName] = {
        name: tableName,
        rowCount: rows.length,
        columns: columns.length > 0 ? columns : rows.length > 0 ? Object.keys(rows[0]) : [],
        rows,
      };
      totalChangedRows += rows.length;
    } catch (err: any) {
      console.warn(`[BackupEngine] Failed to dump table "${tableName}":`, err.message);
    }
  }

  const dataPayload = JSON.stringify(tables);
  const checksum = `sha256:${await sha256Hex(dataPayload)}`;

  return {
    version: 1,
    mode: "full",
    service,
    timestamp: now,
    createdAt: new Date(now).toISOString(),
    totalChangedRows,
    checksum,
    tables,
    metadata: options.metadata,
  };
}

/**
 * 导出 D1 数据库自 sinceTimestamp 以来发生变更的增量数据
 */
export async function exportD1Incremental(
  db: any,
  options: D1IncrementalExportOptions
): Promise<IncrementalBackupBundle> {
  const service = options.serviceName || "service";
  const sinceTimestamp = options.sinceTimestamp || 0;
  const untilTimestamp = options.untilTimestamp || Date.now();
  const staticTables = new Set(options.staticTables || ["settings", "site_config"]);
  const allTables = await getD1UserTables(db);

  let targetTables = allTables;
  if (options.includeTables && options.includeTables.length > 0) {
    const incSet = new Set(options.includeTables);
    targetTables = targetTables.filter((t) => incSet.has(t));
  }
  if (options.excludeTables && options.excludeTables.length > 0) {
    const excSet = new Set(options.excludeTables);
    targetTables = targetTables.filter((t) => !excSet.has(t));
  }

  const tables: Record<string, TableBackupData> = {};
  const staticConfig: Record<string, any> = {};
  let totalChangedRows = 0;

  // 将 sinceTimestamp 转化为 ISO 字符串供 TEXT 类型时间字段比较 (如 2026-09-17 12:00:00)
  const sinceIso = new Date(sinceTimestamp).toISOString().replace("T", " ").replace("Z", "");

  for (const tableName of targetTables) {
    try {
      const columns = await getTableColumns(db, tableName);
      const hasUpdatedAt = columns.includes("updated_at");
      const hasCreatedAt = columns.includes("created_at");

      // 静态小配置表：直接全量捕获作为附带快照
      if (staticTables.has(tableName)) {
        const fullDataRes = await db.prepare(`SELECT * FROM "${tableName}"`).all();
        const fullRows: Record<string, any>[] = fullDataRes?.results || [];
        tables[tableName] = {
          name: tableName,
          rowCount: fullRows.length,
          columns,
          rows: fullRows,
        };
        staticConfig[tableName] = fullRows;
        continue;
      }

      let rows: Record<string, any>[] = [];

      if (sinceTimestamp <= 0) {
        // 首次全量增量基线 (sinceTimestamp = 0)
        const fullDataRes = await db.prepare(`SELECT * FROM "${tableName}"`).all();
        rows = fullDataRes?.results || [];
      } else if (hasUpdatedAt) {
        // 优先根据 updated_at 提取增量（兼容数字毫秒戳与 TEXT ISO 格式）
        const numRes = await db
          .prepare(`SELECT * FROM "${tableName}" WHERE updated_at > ? OR updated_at > ?`)
          .bind(sinceTimestamp, sinceIso)
          .all();
        rows = numRes?.results || [];
      } else if (hasCreatedAt) {
        // 追加型表根据 created_at 提取增量
        const numRes = await db
          .prepare(`SELECT * FROM "${tableName}" WHERE created_at > ? OR created_at > ?`)
          .bind(sinceTimestamp, sinceIso)
          .all();
        rows = numRes?.results || [];
      }

      tables[tableName] = {
        name: tableName,
        rowCount: rows.length,
        columns: columns.length > 0 ? columns : rows.length > 0 ? Object.keys(rows[0]) : [],
        rows,
      };
      totalChangedRows += rows.length;
    } catch (err: any) {
      console.warn(`[BackupEngine] Incremental dump failed on table "${tableName}":`, err.message);
    }
  }

  const dataPayload = JSON.stringify(tables);
  const checksum = `sha256:${await sha256Hex(dataPayload)}`;

  return {
    version: 1,
    mode: "incremental",
    service,
    sinceTimestamp,
    untilTimestamp,
    timestamp: untilTimestamp,
    createdAt: new Date(untilTimestamp).toISOString(),
    totalChangedRows,
    checksum,
    tables,
    staticConfig: Object.keys(staticConfig).length > 0 ? staticConfig : undefined,
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
  const batchSize = options.batchSize || 50;

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

      // 分批写入 (避免 D1 SQL 变量上限)
      for (let i = 0; i < tableData.rows.length; i += batchSize) {
        const chunk = tableData.rows.slice(i, i + batchSize);
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

