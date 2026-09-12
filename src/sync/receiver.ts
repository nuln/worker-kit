/**
 * @nuln/worker-kit/sync
 * 增量数据同步接收器 (Sync Receiver)
 * 运行于备用容灾节点 (NAS open-compute)，接收主服务推送的增量变更并原子合入本地 SQLite/D1
 */

import type { D1ChangeEvent, SyncEnv, SyncResponse } from "./types.js";

// 合法 SQL 标识符白名单正则（防止 SQL 注入）
const IDENTIFIER_REGEX = /^[a-zA-Z0-9_]+$/;

/**
 * 校验 SQL 标识符（表名、列名）安全性
 */
function assertSafeIdentifier(name: string, type: "table" | "column"): void {
  if (!name || typeof name !== "string" || !IDENTIFIER_REGEX.test(name)) {
    throw new Error(`[D1-Sync] 非法 ${type} 名称: "${name}"`);
  }
}

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * 转换字段值为 SQLite 友好格式（布尔值 -> 0/1，Date -> 毫秒时间戳/ISO）
 */
function normalizeSqliteValue(val: unknown): unknown {
  if (val === null || val === undefined) {
    return null;
  }
  if (typeof val === "boolean") {
    return val ? 1 : 0;
  }
  if (val instanceof Date) {
    return val.getTime();
  }
  if (typeof val === "object") {
    if (val instanceof Uint8Array || val instanceof ArrayBuffer) {
      return val;
    }
    return JSON.stringify(val);
  }
  return val;
}

/**
 * 处理 D1 增量同步请求
 *
 * @param request 接收到的 HTTP Request
 * @param env 环境变量（读取 BACKUP_SYNC_SECRET，或关联的 D1 数据库）
 * @param customDb 可选显式传入 D1Database 实例（若不传则自动从 env.DB 或 env.database 获取）
 * @returns 标准 Response
 */
export async function handleD1SyncRequest(
  request: Request,
  env: SyncEnv,
  customDb?: unknown
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 1. 认证鉴权 (校验 X-Sync-Secret)
  const incomingSecret =
    request.headers.get("X-Sync-Secret") ||
    request.headers.get("x-sync-secret");
  const expectedSecret =
    env.PEER_SYNC_SECRET ?? env.BACKUP_SYNC_SECRET ?? env.SYNC_SECRET;

  if (!expectedSecret || incomingSecret !== expectedSecret) {
    return new Response(
      JSON.stringify({ ok: false, error: "Unauthorized: Invalid or missing sync secret" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // 2. 解析载荷
  let payload: D1ChangeEvent;
  try {
    payload = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "Bad Request: Invalid JSON payload" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const { table, action = "UPSERT", primaryKey = "id", data } = payload;
  const sourceNodeId =
    payload.sourceNodeId ||
    request.headers.get("X-Sync-Origin-Node") ||
    request.headers.get("x-sync-origin-node") ||
    undefined;

  if (!table || !data || typeof data !== "object") {
    return new Response(
      JSON.stringify({ ok: false, error: "Bad Request: Missing 'table' or 'data'" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // 3. 标识符安全校验
  try {
    assertSafeIdentifier(table, "table");
    assertSafeIdentifier(primaryKey, "column");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 4. 获取数据库实例
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = customDb ?? env.DB ?? env.database;
  if (!db || typeof db.prepare !== "function") {
    return new Response(
      JSON.stringify({ ok: false, error: "Internal Server Error: No valid D1 database binding found" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // 5. 执行 SQLite 幂等操作（带 LWW 冲突时序保护）
  try {
    const primaryKeyCol = toSnakeCase(primaryKey);
    assertSafeIdentifier(primaryKeyCol, "column");

    if (action === "DELETE") {
      const pkValue =
        (data as Record<string, unknown>)[primaryKey] ??
        (data as Record<string, unknown>)[primaryKeyCol];

      if (pkValue === undefined || pkValue === null) {
        return new Response(
          JSON.stringify({ ok: false, error: `Bad Request: Missing primary key '${primaryKey}' for DELETE` }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const sql = `DELETE FROM "${table}" WHERE "${primaryKeyCol}" = ?;`;
      await db.prepare(sql).bind(normalizeSqliteValue(pkValue)).run();
    } else {
      // UPSERT 操作
      const entries = Object.entries(data as Record<string, unknown>);
      if (entries.length === 0) {
        return new Response(
          JSON.stringify({ ok: false, error: "Bad Request: Empty data object" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const columns: string[] = [];
      const values: unknown[] = [];
      const updateClauses: string[] = [];
      let hasUpdatedAt = false;

      for (const [col, val] of entries) {
        const colName = toSnakeCase(col);
        assertSafeIdentifier(colName, "column");
        columns.push(`"${colName}"`);
        values.push(normalizeSqliteValue(val));
        if (colName === "updated_at") {
          hasUpdatedAt = true;
        }
        if (colName !== primaryKeyCol) {
          updateClauses.push(`"${colName}" = excluded."${colName}"`);
        }
      }

      const placeholders = columns.map(() => "?").join(", ");
      let sql: string;

      if (updateClauses.length > 0) {
        // 若包含 updated_at 字段，增加 Last-Write-Wins (LWW) 保护：仅当接收到的时间戳 >= 本地记录时才更新
        const lwwClause = hasUpdatedAt
          ? ` WHERE excluded."updated_at" >= "${table}"."updated_at" OR "${table}"."updated_at" IS NULL`
          : "";
        sql = `INSERT INTO "${table}" (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT("${primaryKeyCol}") DO UPDATE SET ${updateClauses.join(", ")}${lwwClause};`;
      } else {
        // 如果只有主键字段
        sql = `INSERT INTO "${table}" (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT("${primaryKeyCol}") DO NOTHING;`;
      }

      await db.prepare(sql).bind(...values).run();
    }

    const successResult: SyncResponse = {
      ok: true,
      synced: true,
      table,
      action,
      timestamp: Date.now(),
      sourceNodeId,
    };

    return new Response(JSON.stringify(successResult), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[D1-Sync] 本地 SQLite 同步写入失败:`, err);
    return new Response(
      JSON.stringify({ ok: false, error: `Database Execution Error: ${errorMsg}` }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
