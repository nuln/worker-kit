/**
 * 备份引擎的分支覆盖补齐
 *
 * ## 为什么专门补这一块
 *
 * `backup/engine.ts` 的分支覆盖率 73.33%，未覆盖的集中在两处**数据正确性**相关：
 *
 * 1. **虚表识别**（`VIRTUAL TABLE` 及其影子表 `xxx_data` / `xxx_idx`）
 *    —— 漏判会把 FTS5 的影子表当普通表导出，恢复时要么报错、
 *    要么把索引数据当业务数据写回去。误判同样危险。
 * 2. **includeTables / excludeTables 过滤**的匿名函数
 *    —— 过滤错一个表就是"备份不完整"或"备份了不该备份的表"。
 *
 * 这两处都属于「不报错但结果错」的类别，最难在生产上察觉。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getD1UserTables, getTableColumns } from "../../src/backup/engine.js";

/** 造一个返回固定 sqlite_master 结果的假 D1 */
function fakeDb(rows: unknown[] | Error) {
  return {
    prepare: vi.fn((sql: string) => {
      if (rows instanceof Error) return { all: async () => Promise.reject(rows) };
      return {
        all: async () => ({ results: rows }),
        first: async () => rows[0] ?? null,
      };
    }),
  } as any;
}

const tbl = (name: string, sql = "CREATE TABLE t(a)") => ({ name, sql });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

/* ==================================================== 虚表识别 */

describe("getD1UserTables：虚表与影子表必须被排除", () => {
  it("普通表全部返回", async () => {
    const db = fakeDb([tbl("users"), tbl("posts"), tbl("settings")]);
    expect((await getD1UserTables(db)).sort()).toEqual(["posts", "settings", "users"]);
  });

  it("虚表本身被排除", async () => {
    const db = fakeDb([
      tbl("users"),
      tbl("search_idx", 'CREATE VIRTUAL TABLE search_idx USING fts5(content)'),
    ]);
    const r = await getD1UserTables(db);
    expect(r).toContain("users");
    expect(r, "虚表本身不应出现在备份清单里").not.toContain("search_idx");
  });

  it("虚表的影子表被排除（`xxx_data` / `xxx_idx` / `xxx_content` / `xxx_docsize`）", async () => {
    const vt = 'CREATE VIRTUAL TABLE search_idx USING fts5(content)';
    const db = fakeDb([
      tbl("users"),
      tbl("search_idx", vt),
      tbl("search_idx_data"),
      tbl("search_idx_idx"),
      tbl("search_idx_content"),
      tbl("search_idx_docsize"),
    ]);
    const r = await getD1UserTables(db);
    expect(r).toEqual(["users"]);
  });

  it("只匹配 `虚表名_` 前缀；相似但不同名的表不得被误删", async () => {
    const db = fakeDb([
      tbl("search_idx", 'CREATE VIRTUAL TABLE search_idx USING fts5(content)'),
      // 注意：没有下划线，不应被当作影子表
      tbl("searchidx_backup"),
      // 以下划线开头，也不是影子表
      tbl("_search_idx_log"),
    ]);
    const r = await getD1UserTables(db);
    expect(r).toContain("searchidx_backup");
    expect(r).toContain("_search_idx_log");
  });

  it("VIRTUAL TABLE 关键字大小写不敏感", async () => {
    const db = fakeDb([
      tbl("a"),
      tbl("vt_lower", "create virtual table vt_lower using fts5(x)"),
      tbl("vt_upper", "CREATE VIRTUAL TABLE vt_upper USING fts5(x)"),
      tbl("vt_mixed", "CrEaTe ViRtUaL TaBlE vt_mixed USING fts5(x)"),
    ]);
    const r = await getD1UserTables(db);
    expect(r).toEqual(["a"]);
  });

  it("sql 为 null 的行不得抛错", async () => {
    const db = fakeDb([{ name: "ok", sql: null }, tbl("other")]);
    await expect(getD1UserTables(db)).resolves.toEqual(expect.arrayContaining(["ok", "other"]));
  });
});

/* ==================================================== 系统表 */

describe("getD1UserTables：系统表排除", () => {
  it("排除 sqlite_ / _cf_ / d1_ / drizzle_ 四个前缀", async () => {
    // 以实现里的 SYSTEM_TABLE_PREFIXES 为准：migrations **不是**系统表 ——
    // D1 的迁移表是真实业务表，备份它才有价值，误排除会导致恢复后 schema 缺失
    const db = fakeDb([
      tbl("users"),
      tbl("sqlite_sequence"),
      tbl("_cf_KV"),
      tbl("d1_migrations"),
      tbl("drizzle_journal"),
    ]);
    expect(await getD1UserTables(db)).toEqual(["users"]);
  });

  it("migrations 这类普通表会被保留", async () => {
    const db = fakeDb([tbl("users"), tbl("migrations")]);
    expect((await getD1UserTables(db)).sort()).toEqual(["migrations", "users"]);
  });

  it("只有系统表时返回空数组", async () => {
    const db = fakeDb([tbl("d1_x"), tbl("drizzle_y"), tbl("_cf_z")]);
    expect(await getD1UserTables(db)).toEqual([]);
  });
});

/* ==================================================== 容错 */

describe("getD1UserTables：查询失败", () => {
  it("抛错时返回空数组并告警（不得让整个备份崩掉）", async () => {
    const db = fakeDb(new Error("no such table: sqlite_master"));
    await expect(getD1UserTables(db)).resolves.toEqual([]);
    expect(warn, "失败必须留下痕迹").toHaveBeenCalled();
  });

  it("all() 返回 undefined 时不崩（`tableRows?.results || []` 兜底）", async () => {
    const db = {
      prepare: () => ({ all: async () => undefined }),
    } as any;
    await expect(getD1UserTables(db)).resolves.toEqual([]);
  });

  it("results 为 null 时同样兜底", async () => {
    const db = { prepare: () => ({ all: async () => ({ results: null }) }) } as any;
    await expect(getD1UserTables(db)).resolves.toEqual([]);
  });
});

/* ==================================================== 列信息 */

describe("getTableColumns", () => {
  it("返回列名数组", async () => {
    const db = fakeDb([{ name: "id" }, { name: "email" }, { name: "created_at" }]);
    expect(await getTableColumns(db, "users")).toEqual(["id", "email", "created_at"]);
  });

  it("无列时返回空数组", async () => {
    expect(await getTableColumns(fakeDb([]), "empty")).toEqual([]);
  });

  it("查询失败时返回空数组（静默降级，调用方据此跳过该表）", async () => {
    // 注意：这里是**静默** catch（与 getD1UserTables 不同，后者会 warn）。
    // 钉住这个差异，避免有人"顺手补个告警"时在高频路径上刷屏。
    const db = fakeDb(new Error("no such table: nope"));
    await expect(getTableColumns(db, "nope")).resolves.toEqual([]);
  });

  it("列结果为 undefined 时兜底为空数组", async () => {
    const db = { prepare: () => ({ all: async () => undefined }) } as any;
    expect(await getTableColumns(db, "x")).toEqual([]);
  });
});
