/**
 * 灾备同步：ISO 8601 时间戳被误存为 TEXT，导致 LWW 删除守卫永久失效。
 *
 * ## 缺陷本体
 *
 * 发送端用 `JSON.stringify` 序列化 payload，`Date` 变成 ISO 字符串
 * （`"2026-09-29T00:54:39.237Z"`）。接收端 `normalizeSqliteValue` 收到的
 * 已不是 `Date` 实例，落到 `typeof val === "string"` 分支被**原样写入**
 * `integer({ mode: "timestamp" })` 列。
 *
 * SQLite 不做隐式类型转换 → 列里 `typeof(updated_at) = 'text'`。
 *
 * 而 LWW 删除守卫是：
 *
 * ```sql
 * DELETE FROM t WHERE pk = ? AND (updated_at IS NULL OR updated_at <= ?)
 * ```
 *
 * 右边的 `?` 是数字毫秒时间戳。SQLite 类型排序为
 * `NULL < INTEGER/REAL < TEXT < BLOB` —— **任何 TEXT 都大于任何 INTEGER**，
 * 于是该条件对任意时间戳恒为 `false`。
 *
 * ## 后果（为什么这不是小毛病）
 *
 * 灾备同步的**删除事件被永久静默丢弃**：接收端返回 200、不打一行日志，
 * 但一条记录都没删。主站删掉的账户在备站一直留存，DR 恢复后数据"复活"，
 * 且没有任何迹象表明同步曾经失败。
 *
 * 同源问题还有第二处：Drizzle 以 timestamp 模式读回 TEXT 会得到
 * `Date { NaN }`，调用侧拿到无效日期且无从判断。
 *
 * ## 本套件的断言策略
 *
 * 分两层，缺一不可：
 *
 * 1. **真实 SQLite 行为层**（`node:sqlite`）—— 证明守卫在 TEXT 与 INTEGER
 *    两种绑定下的行为差异。仅断言"值被转换了"是不够的：那不能证明
 *    转换之后守卫真的会放行删除。
 * 2. **端到端绑定层** —— 经 `handleD1SyncRequest` 走一遍，断言 DELETE
 *    守卫的第二个绑定是 `number` 而非 `string`。这是修复真正生效的证据。
 */

import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { handleD1SyncRequest } from "../../src/sync/receiver.js";

/**
 * `node:sqlite` 通过 `createRequire` 运行时载入：类型声明在 test/node-fs.d.ts
 * （沿用本仓库既有做法 —— 不为测试引入 `@types/node`，也不用 `@ts-ignore`）。
 *
 * 基准路径取 `process.cwd()` 而非 `import.meta.url`：本 tsconfig 未引入
 * Vite/DOM 类型，`import.meta` 上没有 `url` 属性。node:sqlite 是内置模块，
 * 基准路径指向何处都不影响解析。
 */
const { DatabaseSync } = createRequire(process.cwd())("node:sqlite") as {
  DatabaseSync: new (location: string) => import("node:sqlite").DatabaseSync;
};

const SECRET = "sync_secret_for_iso_timestamp_tests";

interface Executed {
  sql: string;
  bindings: unknown[];
}

/**
 * 构造支持 PRAGMA table_info 的 mock D1，并**记录**所有实际执行的 SQL 绑定。
 *
 * 与既有 LWW 套件同一形状 —— 本套件关心的是"传进 SQL 的值是什么类型"，
 * 真实执行行为交由上面那层 `node:sqlite` 用例覆盖。
 */
function createDb(columns: string[]) {
  const executed: Executed[] = [];

  const db = {
    executed,
    prepare(sql: string) {
      if (/PRAGMA table_info/i.test(sql)) {
        return {
          all: vi.fn().mockImplementation(async () => ({
            success: true,
            results: columns.map((name) => ({ name })),
          })),
        };
      }
      return {
        bind: (...bindings: unknown[]) => ({
          run: vi.fn().mockImplementation(async () => {
            executed.push({ sql, bindings });
            return { success: true, meta: { changes: 1 } };
          }),
        }),
      };
    },
  };

  return db;
}

function postReq(body: unknown): Request {
  return new Request("http://localhost/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Sync-Secret": SECRET },
    body: JSON.stringify(body),
  });
}

const env = { BACKUP_SYNC_SECRET: SECRET };
const WITH_UPDATED_AT = ["id", "email", "created_at", "updated_at"];

describe("真实 SQLite：LWW 删除守卫对 TEXT / INTEGER 绑定的行为差异", () => {
  it("TEXT 绑定的 updated_at 使守卫恒为 false —— 这就是缺陷本体", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (id TEXT, updated_at INTEGER)");
    const ts = 1_790_643_308_522;

    // 缺陷态：ISO 串被写进 INTEGER 列
    db.exec("INSERT INTO t VALUES ('a', '2026-09-29T00:54:39.237Z')");
    expect(
      db.prepare("SELECT typeof(updated_at) AS t FROM t").get(),
      "ISO 串存进 INTEGER 列后 typeof 必须是 text",
    ).toMatchObject({ t: "text" });

    const before = db.prepare("DELETE FROM t WHERE id = ? AND (updated_at IS NULL OR updated_at <= ?)").run("a", ts);
    expect(before.changes, "缺陷态下删除必须被拒绝（changes=0）—— 事件被静默丢弃").toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS c FROM t").get()).toMatchObject({ c: 1 });

    // 修复态：毫秒整数
    db.exec("DELETE FROM t");
    db.prepare("INSERT INTO t VALUES (?, ?)").run("a", ts);
    expect(db.prepare("SELECT typeof(updated_at) AS t FROM t").get()).toMatchObject({ t: "integer" });

    const after = db.prepare("DELETE FROM t WHERE id = ? AND (updated_at IS NULL OR updated_at <= ?)").run("a", ts);
    expect(after.changes, "修复态下删除必须生效（changes=1）").toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS c FROM t").get()).toMatchObject({ c: 0 });

    db.close();
  });

  it("守卫的语义本身没坏：陈旧删除仍应被拒（防止被修成无条件删除）", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (id TEXT, updated_at INTEGER)");
    const localNewer = 1_800_000_000_000;
    db.prepare("INSERT INTO t VALUES (?, ?)").run("a", localNewer);

    // 删除事件的时间戳比本地记录更早 → 不得删除
    const stale = db
      .prepare("DELETE FROM t WHERE id = ? AND (updated_at IS NULL OR updated_at <= ?)")
      .run("a", localNewer - 1_000);
    expect(stale.changes, "陈旧删除事件必须被 LWW 拒绝").toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS c FROM t").get()).toMatchObject({ c: 1 });

    db.close();
  });
});

describe("端到端：ISO 8601 字符串被转成毫秒整数后写入", () => {
  it("UPSERT 载荷里的 ISO 时间戳绑定为 number（非 string）", async () => {
    const db = createDb(WITH_UPDATED_AT);
    const iso = "2026-09-29T00:54:39.237Z";

    const res = await handleD1SyncRequest(
      postReq({
        table: "users",
        action: "UPSERT",
        primaryKey: "id",
        data: { id: "u1", email: "a@b.c", created_at: iso, updated_at: iso },
        timestamp: Date.parse(iso),
      }),
      { ...env, DB: db } as any,
    );
    expect(res.status).toBe(200);

    const inserts = db.executed.filter((e) => /^\s*INSERT/i.test(e.sql));
    expect(inserts.length).toBeGreaterThan(0);

    // 所有时间戳绑定都必须是 number
    for (const e of inserts) {
      for (const b of e.bindings) {
        if (typeof b === "string" && b.includes("T")) {
          throw new Error(`ISO 时间戳未转换，仍以字符串绑定：${b}`);
        }
      }
    }
    // 且确实绑定了毫秒整数
    expect(inserts.some((e) => e.bindings.some((b) => typeof b === "number" && b > 1_000_000_000_000))).toBe(
      true,
    );
  });

  it("DELETE 守卫的第二个绑定是数字时间戳（这是删除能否生效的命门）", async () => {
    const db = createDb(WITH_UPDATED_AT);
    const ts = 1_790_643_308_522;

    const res = await handleD1SyncRequest(
      postReq({ table: "users", action: "DELETE", data: { id: "u42" }, timestamp: ts }),
      { ...env, DB: db } as any,
    );
    expect(res.status).toBe(200);

    const del = db.executed.find((e) => /^\s*DELETE/i.test(e.sql));
    expect(del, "必须发出带 LWW 守卫的 DELETE").toBeDefined();
    expect(del?.sql).toMatch(/updated_at/);
    expect(del?.sql).toMatch(/<=\s*\?/i);

    // 命门：比较值必须是数字。string 会让 SQLite 按类型优先级判为
    // "TEXT > INTEGER"，条件恒 false，删除被静默丢弃。
    const guardValue = del?.bindings[del.bindings.length - 1];
    expect(typeof guardValue, "守卫比较值必须是 number").toBe("number");
    expect(guardValue).toBe(ts);
  });

  it("UPSERT 的 LWW 守卫比较值同样来自事件 timestamp（number）", async () => {
    const db = createDb(WITH_UPDATED_AT);
    const iso = "2026-09-29T00:54:39.237Z";
    const ts = Date.parse(iso);

    await handleD1SyncRequest(
      postReq({
        table: "users",
        action: "UPSERT",
        primaryKey: "id",
        data: { id: "u1", updated_at: iso },
        timestamp: ts,
      }),
      { ...env, DB: db } as any,
    );

    const upserts = db.executed.filter((e) => /^\s*INSERT/i.test(e.sql));
    expect(upserts.length).toBeGreaterThan(0);
    // 只校验时间戳绑定 —— 主键 / 业务列本就是字符串，
    // 一律要求 number 会把这条断言写成永远失败的样子（假门禁）。
    for (const e of upserts) {
      for (const b of e.bindings) {
        if (typeof b === "string" && b.includes("T")) {
          throw new Error(`时间戳仍以字符串绑定：${b}`);
        }
      }
    }
    // updated_at 实际绑定为毫秒整数
    expect(upserts.some((e) => e.bindings.includes(ts))).toBe(true);
  });
});

describe("不误伤：非 ISO 字符串必须原样保留", () => {
  it("业务字符串（ID、枚举、URL）不被误当作时间戳转换", async () => {
    const db = createDb(["id", "email", "note", "code", "created_at", "updated_at"]);
    const res = await handleD1SyncRequest(
      postReq({
        table: "users",
        action: "UPSERT",
        primaryKey: "id",
        data: {
          id: "u1",
          // 这些长得像日期但不是 ISO 8601 带时区的完整形式，必须原样保留
          note: "2026-09-29",
          code: "T12:00:00",
          email: "a@b.c",
          created_at: "2026-09-29T00:54:39.237Z",
          updated_at: "2026-09-29T00:54:39.237Z",
        },
        timestamp: Date.parse("2026-09-29T00:54:39.237Z"),
      }),
      { ...env, DB: db } as any,
    );
    expect(res.status).toBe(200);

    const insert = db.executed.find((e) => /^\s*INSERT/i.test(e.sql));
    expect(insert).toBeDefined();
    const bound = insert?.bindings;
    expect(bound, "裸日期字符串必须原样保留").toContain("2026-09-29");
    expect(bound, "时间样式字符串必须原样保留").toContain("T12:00:00");
  });

  it("形似 ISO 但无法解析的字符串保留原值（不静默变成 1970）", async () => {
    const db = createDb(["id", "updated_at"]);
    await handleD1SyncRequest(
      postReq({
        table: "users",
        action: "UPSERT",
        primaryKey: "id",
        data: { id: "u1", updated_at: "2026-13-45T99:99:99Z" },
        timestamp: 1_700_000_000_000,
      }),
      { ...env, DB: db } as any,
    );
    const insert = db.executed.find((e) => /^\s*INSERT/i.test(e.sql));
    expect(insert?.bindings).toContain("2026-13-45T99:99:99Z");
  });
});
