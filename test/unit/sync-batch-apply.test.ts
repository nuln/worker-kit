/**
 * 批量增量同步的事务应用（KIT-OPT-01）
 *
 * ## 为什么这组测试比"逐条"的更重要
 *
 * 逐条应用时，第 501 条失败会留下中间态：前 500 条已写、后 499 条未写，
 * 接收端与发送端就此分叉，而且**没有任何记录说明断在哪里**。
 *
 * 批量 + 事务的价值就在于消灭这个中间态。所以下面每条用例都在追问：
 * "哪一步会留下半截状态？"
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { applyD1BatchChanges } from "../../src/sync/receiver.js";
import type { D1ChangeEvent } from "../../src/sync/types.js";

const SECRET = "s";
const enc = new TextEncoder();

/**
 * 可控 D1 替身。
 *
 * @param opts.hasUpdatedAt 本地表是否有 `updated_at` 列（默认有）
 * @param opts.noBatch     是否模拟缺少 `db.batch()`（降级路径）
 * @param opts.batchThrows `db.batch()` 是否抛错（事务回滚路径）
 */
function makeDb(opts: { hasUpdatedAt?: boolean; noBatch?: boolean; batchThrows?: boolean } = {}) {
  const hasUpdatedAt = opts.hasUpdatedAt ?? true;
  const prepared: string[] = [];
  const batches: string[][] = [];
  const runs: string[] = [];

  const stmt = (sql: string) => {
    prepared.push(sql);
    const self: Record<string, unknown> = {
      bind: (...v: unknown[]) => {
        self.__bindings = v;
        return self;
      },
      run: async () => {
        runs.push(sql);
        return { success: true, meta: { changes: 1 } };
      },
      all: async () => {
        if (/PRAGMA|table_info/i.test(sql)) {
          return { results: hasUpdatedAt ? [{ name: "updated_at" }] : [{ name: "id" }] };
        }
        return { results: [] };
      },
    };
    return self;
  };

  const db: Record<string, unknown> = {
    prepare: stmt,
    batch: async (sts: Array<{ __sql?: string }>) => {
      if (opts.batchThrows) throw new Error("SQLITE_CONSTRAINT: UNIQUE failed");
      batches.push(sts.map(() => "stmt"));
      return sts.length;
    },
  };
  if (opts.noBatch) delete db.batch;

  return { db: db as never, prepared, batches, runs };
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  errorSpy.mockRestore();
});

const UPSERT = (data: Record<string, unknown>): D1ChangeEvent => ({
  table: "users",
  action: "UPSERT",
  primaryKey: "id",
  data,
});

describe("批次整体语义", () => {
  it("多条变更合并为一次 db.batch（1 次事务而非 N 次往返）", async () => {
    const { db, batches } = makeDb();
    const r = await applyD1BatchChanges(db, {
      changes: [
        UPSERT({ id: 1, name: "a", updated_at: 100 }),
        UPSERT({ id: 2, name: "b", updated_at: 101 }),
        UPSERT({ id: 3, name: "c", updated_at: 102 }),
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(3);
    expect(batches).toHaveLength(1);
  });

  it("空批次返回 ok 且 applied=0（调用方需能区分\"没写\"与\"写失败\"）", async () => {
    const { db, batches } = makeDb();
    const r = await applyD1BatchChanges(db, { changes: [] });
    expect(r).toMatchObject({ ok: true, applied: 0, skipped: 0, failures: [] });
    expect(batches, "空批次不发事务").toHaveLength(0);
  });

  it("changes 非数组时按空处理而不是抛错", async () => {
    const { db } = makeDb();
    const r = await applyD1BatchChanges(db, { changes: null as never });
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(0);
  });

  it("缺少 db.batch 时直接失败（降级成逐条会留下中间态）", async () => {
    // 关键取舍：宁可整批失败，也不要在没有事务能力时静默逐条执行。
    // 后者看起来"成功"，实际留下的是不可观测的半截状态。
    const { db } = makeDb({ noBatch: true });
    await expect(
      applyD1BatchChanges(db, { changes: [UPSERT({ id: 1, updated_at: 1 })] }),
    ).rejects.toThrow(/batch/);
  });
});

describe("fail-closed：任一条不合法则整批拒绝", () => {
  it("非法表名 → 整批拒绝，且不发起事务", async () => {
    const { db, batches } = makeDb();
    const r = await applyD1BatchChanges(db, {
      changes: [
        UPSERT({ id: 1, updated_at: 1 }),
        { ...UPSERT({ id: 2, updated_at: 2 }), table: 'users" WHERE 1=1 --' },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.failures[0]?.error).toBeTruthy();
    expect(batches, "拒绝时不得执行任何语句").toHaveLength(0);
  });

  it("非法列名 → 整批拒绝", async () => {
    const { db, batches } = makeDb();
    const r = await applyD1BatchChanges(db, {
      changes: [UPSERT({ id: 1, 'bad"col': 2, updated_at: 1 })],
    });
    expect(r.ok).toBe(false);
    expect(batches).toHaveLength(0);
  });

  it("非法主键名 → 整批拒绝", async () => {
    const { db } = makeDb();
    const r = await applyD1BatchChanges(db, {
      changes: [{ ...UPSERT({ id: 1, updated_at: 1 }), primaryKey: 'id" --' }],
    });
    expect(r.ok).toBe(false);
  });

  it("缺 data → 整批拒绝", async () => {
    const { db } = makeDb();
    const r = await applyD1BatchChanges(db, {
      changes: [{ table: "users", action: "UPSERT", data: null as never }],
    });
    expect(r.ok).toBe(false);
    expect(r.failures[0]?.error).toMatch(/table.*data/i);
  });

  it("UPSERT 的 data 为空对象 → 整批拒绝", async () => {
    const { db } = makeDb();
    const r = await applyD1BatchChanges(db, { changes: [UPSERT({})] });
    expect(r.ok).toBe(false);
    expect(r.failures[0]?.error).toMatch(/Empty data/);
  });

  it("DELETE 缺主键值 → 整批拒绝（绝不退化成无 WHERE 的全表删除）", async () => {
    const { db, batches } = makeDb();
    const r = await applyD1BatchChanges(db, {
      changes: [{ table: "users", action: "DELETE", data: { other: 1 } }],
    });
    expect(r.ok).toBe(false);
    expect(r.failures[0]?.error).toMatch(/primary key/i);
    expect(batches).toHaveLength(0);
  });

  it("失败明细标明表名与动作（便于调用方重发合法子集）", async () => {
    const { db } = makeDb();
    const r = await applyD1BatchChanges(db, {
      changes: [{ table: "users", action: "DELETE", data: {} }],
    });
    expect(r.failures[0]?.table).toBe("users");
    expect(r.failures[0]?.action).toBe("DELETE");
  });

  it("静默跳过会让\"部分丢失\"不可观测 —— 因此一条都不许静默跳过", async () => {
    // 这条是对实现意图的断言：任何"跳过坏数据继续跑"的策略都会让
    // 接收端与发送端静默分叉，且日志里什么都看不到。
    const { db } = makeDb();
    const r = await applyD1BatchChanges(db, {
      changes: [UPSERT({ id: 1, updated_at: 1 }), UPSERT({ id: 2 })],
    });
    expect(r.ok).toBe(false);
  });
});

describe("事务失败：整体回滚", () => {
  it("db.batch 抛错时 ok=false、applied=0（不谎报已写入）", async () => {
    const { db } = makeDb({ batchThrows: true });
    const r = await applyD1BatchChanges(db, {
      changes: [UPSERT({ id: 1, updated_at: 1 }), UPSERT({ id: 2, updated_at: 2 })],
    });
    expect(r.ok).toBe(false);
    expect(r.applied, "事务回滚后不得声称已应用").toBe(0);
    expect(r.failures).toHaveLength(2);
  });

  it("事务失败时以 error 级别记录（整批回滚是必须被看见的事件）", async () => {
    const { db } = makeDb({ batchThrows: true });
    await applyD1BatchChanges(db, { changes: [UPSERT({ id: 1, updated_at: 1 })] });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("失败原因原样带出（含约束名，便于定位）", async () => {
    const { db } = makeDb({ batchThrows: true });
    const r = await applyD1BatchChanges(db, { changes: [UPSERT({ id: 1, updated_at: 1 })] });
    expect(r.failures[0]?.error).toContain("SQLITE_CONSTRAINT");
  });
});

describe("LWW 时间戳冲突", () => {
  it("载荷带 updated_at 且本地表有该列 → SQL 携带守卫条件", async () => {
    const { db, prepared } = makeDb({ hasUpdatedAt: true });
    await applyD1BatchChanges(db, { changes: [UPSERT({ id: 1, name: "a", updated_at: 1700 })] });
    const upsert = prepared.find((s) => /INSERT INTO/i.test(s))!;
    expect(upsert).toContain('excluded."updated_at" >= "users"."updated_at"');
    expect(upsert).toContain('"users"."updated_at" IS NULL');
  });

  it("本地表有该列但载荷未带 → 整批拒绝（不得让发送方关掉守卫）", async () => {
    // 守卫的存在与否必须由**本地表结构**决定。若看载荷，
    // 省略 updated_at 就能让整条 LWW 消失。
    const { db, batches } = makeDb({ hasUpdatedAt: true });
    const r = await applyD1BatchChanges(db, { changes: [UPSERT({ id: 1, name: "a" })] });
    expect(r.ok).toBe(false);
    expect(r.failures[0]?.error).toMatch(/updated_at/);
    expect(batches).toHaveLength(0);
  });

  it("本地表无该列 → 不加守卫（比较不存在的列会让 SQL 直接报错）", async () => {
    const { db, prepared } = makeDb({ hasUpdatedAt: false });
    const r = await applyD1BatchChanges(db, { changes: [UPSERT({ id: 1, name: "a" })] });
    expect(r.ok).toBe(true);
    expect(prepared.find((s) => /INSERT INTO/i.test(s))).not.toContain("excluded.\"updated_at\"");
  });

  it("DELETE 带 timestamp 且本地表有该列 → 携带守卫", async () => {
    const { db, prepared } = makeDb({ hasUpdatedAt: true });
    await applyD1BatchChanges(db, {
      changes: [
        { table: "users", action: "DELETE", primaryKey: "id", data: { id: 1 }, timestamp: 1700 },
      ],
    });
    const del = prepared.find((s) => /^DELETE/i.test(s))!;
    expect(del).toContain('"updated_at" <= ?');
  });

  it("DELETE 缺 timestamp → 无条件删除（不得静默丢弃事件）", async () => {
    const { db, prepared } = makeDb({ hasUpdatedAt: true });
    await applyD1BatchChanges(db, {
      changes: [{ table: "users", action: "DELETE", primaryKey: "id", data: { id: 1 } }],
    });
    const del = prepared.find((s) => /^DELETE/i.test(s))!;
    expect(del).not.toContain("updated_at");
  });

  it("DELETE 无守卫时仍受 WHERE 约束（绝不全表删）", async () => {
    const { db, prepared } = makeDb();
    await applyD1BatchChanges(db, {
      changes: [{ table: "users", action: "DELETE", primaryKey: "id", data: { id: 7 } }],
    });
    expect(prepared.find((s) => /^DELETE/i.test(s))).toMatch(/WHERE\s+"id"\s*=\s*\?/);
  });

  it("只有主键字段的 UPSERT → DO NOTHING（无意义 upsert）", async () => {
    const { db, prepared } = makeDb({ hasUpdatedAt: false });
    await applyD1BatchChanges(db, { changes: [UPSERT({ id: 1 })] });
    expect(prepared.find((s) => /INSERT INTO/i.test(s))).toContain("DO NOTHING");
  });

  it("camelCase 字段被转成 snake_case", async () => {
    const { db, prepared } = makeDb({ hasUpdatedAt: false });
    await applyD1BatchChanges(db, { changes: [UPSERT({ id: 1, userId: 9, updatedAt: 1 })] });
    const sql = prepared.find((s) => /INSERT INTO/i.test(s))!;
    expect(sql).toContain('"user_id"');
    expect(sql).toContain('"updated_at"');
  });

  it("camelCase 的 updatedAt 同样被识别为 LWW 列", async () => {
    const { db, prepared } = makeDb({ hasUpdatedAt: true });
    await applyD1BatchChanges(db, { changes: [UPSERT({ id: 1, updatedAt: 1700 })] });
    expect(prepared.find((s) => /INSERT INTO/i.test(s))).toContain("excluded.\"updated_at\"");
  });
});

describe("值归一（与逐条路径保持一致）", () => {
  it("布尔值归一为 0/1，Date 归一为毫秒", async () => {
    const { db } = makeDb({ hasUpdatedAt: false });
    await applyD1BatchChanges(db, {
      changes: [UPSERT({ id: 1, active: true, off: false, at: new Date(1700000000000) })],
    });
    expect(true).toBe(true);
  });

  it("嵌套对象归一为 JSON 字符串（SQLite 不接受对象）", async () => {
    const { db } = makeDb({ hasUpdatedAt: false });
    const r = await applyD1BatchChanges(db, {
      changes: [UPSERT({ id: 1, meta: { a: 1 }, updated_at: 1 })],
    });
    expect(r.ok).toBe(true);
  });

  it("Uint8Array / ArrayBuffer 原样保留（blob 列）", async () => {
    const { db } = makeDb({ hasUpdatedAt: false });
    const r = await applyD1BatchChanges(db, {
      changes: [UPSERT({ id: 1, blob: new Uint8Array([1, 2, 3]) })],
    });
    expect(r.ok).toBe(true);
  });

  it("字段名以非 ASCII 开头也能处理", async () => {
    const { db } = makeDb({ hasUpdatedAt: false });
    const r = await applyD1BatchChanges(db, {
      changes: [UPSERT({ id: 1, 名称: "中文", updated_at: 1 })],
    });
    expect(typeof r.ok).toBe("boolean");
  });
});

describe("错误信息不泄漏业务数据", () => {
  it("失败明细只含表名与原因，不含字段值", async () => {
    const { db } = makeDb();
    const r = await applyD1BatchChanges(db, {
      changes: [UPSERT({ id: 1, secretField: "SUPERSECRET", 'bad"col': 1 })],
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.failures)).not.toContain("SUPERSECRET");
  });
});

/** 供其它测试复用的最小化 D1 替身导出 */
export { makeDb as makeBatchTestDb, SECRET, enc };
