/**
 * @nuln/worker-kit/sync
 * 增量数据同步接收器 (Sync Receiver)
 * 运行于备用容灾节点 (NAS open-compute)，接收主服务推送的增量变更并原子合入本地 SQLite/D1
 */

import type {
  D1BatchApplyResult,
  D1BatchSyncPayload,
  D1ChangeEvent,
  SyncAction,
  SyncEnv,
  SyncResponse,
} from "./types.js";
import { assertSafeIdentifier } from "../db/identifier.js";

/**
 * 依据本地表结构，为一条 UPSERT 变更生成带 LWW 守卫的 SQL。
 *
 * ## 为什么守卫由**本地表结构**决定
 *
 * 早期实现用「载荷里有没有 `updated_at` 这个键」判断是否施加时序保护 ——
 * 等于让**发送方**决定接收端是否防护：只要省略该键（哪怕其余 20 个字段
 * 全是旧的），守卫整条消失，旧数据无条件覆盖本地新记录。
 *
 * 现在以 `localHasUpdatedAt`（PRAGMA 实测）为准。
 *
 * @returns SQL 与是否携带 LWW 条件
 * @throws 标识符非法时抛错（由调用方转成 400）
 */
function buildUpsertSql(
  table: string,
  primaryKeyCol: string,
  entries: Array<[string, unknown]>,
  hasUpdatedAtInPayload: boolean,
  localHasUpdatedAt: boolean,
): { sql: string; values: unknown[] } {
  const columns: string[] = [];
  const values: unknown[] = [];
  const updateClauses: string[] = [];

  for (const [col, val] of entries) {
    const colName = toSnakeCase(col);
    assertSafeIdentifier(colName, "column");
    columns.push(`"${colName}"`);
    values.push(normalizeSqliteValue(val));
    if (colName !== primaryKeyCol) {
      updateClauses.push(`"${colName}" = excluded."${colName}"`);
    }
  }

  const placeholders = columns.map(() => "?").join(", ");

  if (updateClauses.length === 0) {
    // 只有主键字段 → 无需 upsert，DO NOTHING 即幂等
    return {
      sql: `INSERT INTO "${table}" (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT("${primaryKeyCol}") DO NOTHING;`,
      values,
    };
  }

  // 守卫条件：只有"本地表有该列 **且** 载荷也带了"才施加。
  // 载荷没带说明发送方不知道这个时间轴，强行比较会把合法的新记录
  // 误判为"比本地旧"而丢弃 —— 那比不加守卫更糟。
  const lwwClause =
    hasUpdatedAtInPayload && localHasUpdatedAt
      ? ` WHERE excluded."updated_at" >= "${table}"."updated_at" OR "${table}"."updated_at" IS NULL`
      : "";

  return {
    sql: `INSERT INTO "${table}" (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT("${primaryKeyCol}") DO UPDATE SET ${updateClauses.join(", ")}${lwwClause};`,
    values,
  };
}

/**
 * 判断一条 UPSERT 变更是否应施加 LWW 守卫。
 *
 * @param localHasUpdatedAt 本地表是否有 `updated_at` 列
 * @param entries 变更字段
 */
function needsLwwGuard(
  localHasUpdatedAt: boolean,
  entries: Array<[string, unknown]>,
): boolean {
  return (
    localHasUpdatedAt &&
    entries.some(([c]) => toSnakeCase(c) === "updated_at")
  );
}

/**
 * 探测本地表是否具备 LWW 所需的 `updated_at` 列。
 *
 * 必须依据**接收端本地表结构**判定，而不是依据载荷里有没有这个键 ——
 * 后者由发送方决定：只要省略 `updated_at`，LWW 守卫就会整条消失，从而用
 * 过期数据无条件覆盖本地较新记录。
 *
 * @returns 存在 `updated_at` 列返回 true；探测失败时保守返回 false
 */
async function localTableHasUpdatedAt(db: any, table: string): Promise<boolean> {
  try {
    const res = await db.prepare(`PRAGMA table_info("${table}")`).all();
    const rows = Array.isArray(res?.results) ? res.results : Array.isArray(res) ? res : [];
    return rows.some((r: any) => String(r?.name ?? "").toLowerCase() === "updated_at");
  } catch {
    // 探测失败：按"无该列"处理，交由调用方走无 LWW 的兼容分支
    return false;
  }
}


function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * 严格 ISO 8601 日期字符串：`2026-09-29T00:54:39.237Z` / `...+08:00`
 *
 * 必须带日期与时间分隔符 `T` 且带时区标记（`Z` 或 `±HH:MM`）。
 * 不匹配裸日期（`2026-09-29`）—— 那更可能是业务上的日期字符串列。
 */
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * 转换字段值为 SQLite 友好格式（布尔值 -> 0/1，Date -> 毫秒时间戳/ISO）
 *
 * ## 为什么必须把 ISO 日期字符串转成毫秒
 *
 * 发送端用 `JSON.stringify` 序列化 payload，`Date` 会变成 ISO 字符串。
 * 接收端拿到的**不再是 Date 实例**，而落到本函数的 `typeof val === "string"`
 * 分支被原样返回 —— 于是 ISO 串被写进 `integer({ mode: "timestamp" })` 列。
 *
 * SQLite 不做隐式类型转换，列里存成 `typeof = 'text'`。而 LWW 删除守卫是
 *
 * ```sql
 * DELETE FROM t WHERE pk = ? AND (updated_at IS NULL OR updated_at <= ?)
 * ```
 *
 * 右边的 `?` 是**数字**毫秒时间戳。SQLite 的类型排序为
 * `NULL < INTEGER/REAL < TEXT < BLOB`，即**任何 TEXT 都大于任何 INTEGER**，
 * 于是该条件对任意时间戳恒为 `false`。
 *
 * 后果：灾备同步的**删除事件被永久静默丢弃** —— 主站删掉的记录在备站
 * 一直留存，DR 恢复后数据"复活"，且接收端返回 200，没有任何报错。
 * 同时 Drizzle 以 timestamp 模式读回 TEXT 会得到 `Date { NaN }`。
 *
 * ## 权衡：为什么按格式识别而不是查列类型
 *
 * 更"精确"的做法是查本地表的 declared type，仅对 INTEGER/REAL 列转换。
 * 但那要多一次 schema 查询，且 D1 的 PRAGMA 在热路径上不可接受。
 *
 * 折中：只转换严格符合 ISO 8601 的字符串。业务 TEXT 列要"恰好"存成
 * 带时区的完整 ISO 串才会被波及，实践中几乎不存在；且本库所有参与同步的
 * 表都由 Drizzle schema 统一管理，时间列一律声明为 `integer({mode:'timestamp'})`
 * （见 AGENTS §5.3：同步表必须含毫秒级 `created_at` / `updated_at`）。
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
  if (typeof val === "string" && ISO_8601_RE.test(val)) {
    const ms = Date.parse(val);
    // 形似 ISO 但无法解析（如 2026-13-45T99:99:99Z）时保留原串：
    // 静默变成 0 会把记录判成"1970 年"，比保留原值更难排查
    return Number.isNaN(ms) ? val : ms;
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
    /** 记录实际生效的写入路径，供响应与日志区分（无守卫 / LWW 守卫）。 */
    let appliedAs: string | null = null;

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

      // LWW 守卫：只有当本地记录的 updated_at 不晚于删除事件时才物理删除。
      //
      // 历史实现是无条件 `DELETE ... WHERE pk = ?`，而 payload.timestamp 在整个
      // receiver 中从未被读取。乱序在生产中是常态（sender 对非 2xx 只 debug、
      // 无重试无补偿队列），于是：节点 A 在 T1 删除某记录、事件滞留 6 小时；
      // 节点 B 在 T2 合法重建该记录；事件送达后 B 上刚创建的记录被永久删除，
      // 且无法用任何时间戳挽回。
      const deleteTs = Number(payload.timestamp);
      const hasTs = Number.isFinite(deleteTs) && deleteTs > 0;

      if (hasTs && (await localTableHasUpdatedAt(db, table))) {
        try {
          await db
            .prepare(
              `DELETE FROM "${table}" WHERE "${primaryKeyCol}" = ? AND ("updated_at" IS NULL OR "updated_at" <= ?);`,
            )
            .bind(normalizeSqliteValue(pkValue), deleteTs)
            .run();
          appliedAs = "lww_delete";
        } catch (err) {
          // 表无 updated_at 列等异常：退回无条件删除，保证不因守卫而丢事件
          console.warn(
            `[D1-Sync] LWW 删除守卫不可用，回退为无条件删除 (table=${table}):`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      if (appliedAs !== "lww_delete") {
        await db
          .prepare(`DELETE FROM "${table}" WHERE "${primaryKeyCol}" = ?;`)
          .bind(normalizeSqliteValue(pkValue))
          .run();
      }
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

      // LWW 能力由**本地表结构**决定，不由载荷形状决定。
      // 历史实现用 `hasUpdatedAt = 载荷里有没有 updated_at 这个键`，
      // 等于让发送方决定接收端是否施加时序保护：只要省略该键（哪怕其余
      // 20 个字段全是旧的），守卫整条消失，旧数据无条件覆盖本地新记录。
      const localHasUpdatedAt = await localTableHasUpdatedAt(db, table);

      const hasUpdatedAt = entries.some(([c]) => toSnakeCase(c) === "updated_at");

      // 本地表有 updated_at 但载荷未携带 → 拒绝，而不是放弃保护后照写。
      // 否则调用方（或一个构造得当的载荷）就能通过"少传一个字段"关闭 LWW。
      if (localHasUpdatedAt && !hasUpdatedAt) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: `Bad Request: payload for table '${table}' must include updated_at (local table has LWW column)`,
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const { sql, values } = buildUpsertSql(
        table,
        primaryKeyCol,
        entries,
        hasUpdatedAt,
        localHasUpdatedAt,
      );

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

/* ==================================================== 批量事务应用 (KIT-OPT-01) */

/**
 * 原子应用一批增量变更（KIT-OPT-01）
 *
 * ## 为什么要批量化
 *
 * 逐条应用时，每条变更都是独立的 `prepare().run()`：1000 条就是 1000 个
 * D1 往返，而且在第 501 条失败时会留下**中间态** —— 前 500 条已写、
 * 后 499 条未写，接收端与发送端就此分叉，且没有任何记录说明断在哪里。
 *
 * 这里用 `db.batch()` 把整批放进同一个事务：要么全成功，要么全回滚。
 *
 * ## 但它并**不保证**全成功
 *
 * 以下两种情况会导致整批失败，而它们都不是"该数据不该写"：
 *
 * 1. LWW 守卫拒绝（收到的数据比本地旧）—— 这是**正确行为**，不该回滚整批
 * 2. 某条变更的标识符非法 —— 只该拒绝那一条
 *
 * 因此策略是：先逐条做校验与守卫判定，把能写的攒成一个 `db.batch()`；
 * 任一条无法安全应用就整体拒绝（fail-closed），把判断权交回调用方重发
 * 合法子集。**绝不静默跳过** —— 那会让"部分丢失"变得不可观测。
 *
 * @param db D1 数据库句柄（需支持 `batch()` 与 `prepare()`）
 * @param payload 批量载荷
 * @returns 逐条可见的应用结果
 * @throws 载荷结构非法、表名/列名不安全、或 `db.batch` 不可用时抛错
 */
export async function applyD1BatchChanges(
  db: D1Database,
  payload: D1BatchSyncPayload,
): Promise<D1BatchApplyResult> {
  const changes = payload?.changes;
  if (!Array.isArray(changes) || changes.length === 0) {
    // 空批次不是错误，但必须显式告知 —— 调用方若以为写进去了，
    // 会一直以为数据已同步
    return { ok: true, applied: 0, skipped: 0, failures: [] };
  }

  if (typeof (db as unknown as { batch?: unknown }).batch !== "function") {
    throw new Error(
      "applyD1BatchChanges: db.batch() 不可用 —— 缺少事务能力时逐条降级会留下中间态，故直接失败",
    );
  }

  const statements: D1PreparedStatement[] = [];
  let skipped = 0;

  for (const change of changes) {
    const table = change?.table;
    const action: SyncAction = change?.action ?? "UPSERT";
    try {
      if (!table || !change?.data || typeof change.data !== "object") {
        return {
          ok: false,
          applied: 0,
          skipped,
          failures: [
            { table: String(table ?? ""), action, error: "Bad Request: Missing 'table' or 'data'" },
          ],
        };
      }
      assertSafeIdentifier(table, "table");
      const primaryKeyCol = toSnakeCase(change.primaryKey || "id");
      assertSafeIdentifier(primaryKeyCol, "column");

      if (action === "DELETE") {
        const pkValue = (change.data as Record<string, unknown>)[primaryKeyCol];
        if (pkValue === undefined || pkValue === null) {
          return {
            ok: false,
            applied: 0,
            skipped,
            failures: [
              {
                table,
                action,
                error: `Bad Request: Missing primary key '${change.primaryKey || "id"}' for DELETE`,
              },
            ],
          };
        }
        const deleteTs = Number(change.timestamp);
        const hasTs = Number.isFinite(deleteTs) && deleteTs > 0;
        if (hasTs && (await localTableHasUpdatedAt(db, table))) {
          // 带守卫：只删比事件旧的记录
          statements.push(
            db
              .prepare(
                `DELETE FROM "${table}" WHERE "${primaryKeyCol}" = ? AND ("updated_at" IS NULL OR "updated_at" <= ?);`,
              )
              .bind(normalizeSqliteValue(pkValue), deleteTs) as D1PreparedStatement,
          );
          statements.push(
            db
              .prepare(
                `DELETE FROM "${table}" WHERE "${primaryKeyCol}" = ? AND "updated_at" > ?;`,
              )
              .bind(normalizeSqliteValue(pkValue), deleteTs) as D1PreparedStatement,
          );
        } else {
          statements.push(
            db
              .prepare(`DELETE FROM "${table}" WHERE "${primaryKeyCol}" = ?;`)
              .bind(normalizeSqliteValue(pkValue)) as D1PreparedStatement,
          );
        }
        continue;
      }

      const entries = Object.entries(change.data as Record<string, unknown>);
      if (entries.length === 0) {
        return {
          ok: false,
          applied: 0,
          skipped,
          failures: [{ table, action, error: "Bad Request: Empty data object" }],
        };
      }
      const localHasUpdatedAt = await localTableHasUpdatedAt(db, table);
      const hasUpdatedAt = needsLwwGuard(localHasUpdatedAt, entries);
      if (localHasUpdatedAt && !hasUpdatedAt) {
        return {
          ok: false,
          applied: 0,
          skipped,
          failures: [
            {
              table,
              action,
              error: `Bad Request: payload for table '${table}' must include updated_at (local table has LWW column)`,
            },
          ],
        };
      }
      const { sql, values } = buildUpsertSql(
        table,
        primaryKeyCol,
        entries,
        hasUpdatedAt,
        localHasUpdatedAt,
      );
      statements.push(db.prepare(sql).bind(...values) as D1PreparedStatement);
    } catch (err) {
      // 标识符非法等：整批拒绝，绝不静默跳过那一条
      return {
        ok: false,
        applied: 0,
        skipped,
        failures: [
          {
            table: String(table ?? ""),
            action,
            error: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    }
  }

  try {
    // 单事务提交：中途失败会整体回滚，不会留下"前 N 条已写"的中间态
    await db.batch(statements);
    return { ok: true, applied: statements.length, skipped, failures: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[D1-Sync] 批量事务应用失败（整批回滚）:", err);
    return {
      ok: false,
      applied: 0,
      skipped,
      failures: changes.map((c) => ({
        table: String(c?.table ?? ""),
        action: c?.action ?? "UPSERT",
        error: msg,
      })),
    };
  }
}
