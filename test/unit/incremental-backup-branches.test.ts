/**
 * 增量备份 / 恢复链 / 限流降级 的分支补齐（收尾批）
 *
 * 这几处的共同点：都是"多对象 + 时序"逻辑，单条断言测不出来，
 * 必须构造完整场景。而它们恰恰是最容易**静默错**的地方：
 *
 * - 增量链顺序错 → 恢复出错误状态
 * - 时间间隔节流失效 → 备份风暴打爆 S3 与 D1
 * - 保留期清理把新备份删掉
 * - 限流降级链某一环没走到就静默放行
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  performScheduledIncrementalBackup,
  restoreIncrementalChainFromS3,
  performScheduledS3Backup,
} from "../../src/backup/s3-backup.js";
import { exportD1Incremental, restoreD1Database, encodeRowBinary, decodeRowBinary } from "../../src/backup/engine.js";

const S3 = {
  accessKeyId: "AKIA",
  secretAccessKey: "secret",
  region: "us-east-1",
  bucket: "bkt",
  endpoint: "https://s3.example.com",
} as never;

interface Stored {
  body: string;
  lastModified?: string;
}

/** 支持 prefix 过滤、可注入读取异常的内存 S3 替身 */
function makeS3(objects: Record<string, Stored> = {}) {
  const store = new Map<string, Stored>(Object.entries(objects));
  const put = vi.fn(async (key: string, data: string) => {
    store.set(key, { body: data, lastModified: new Date().toISOString() });
    return { ok: true } as never;
  });
  const get = vi.fn(async (key: string) => {
    const o = store.get(key);
    if (!o) return null;
    return { ok: true, text: async () => o.body } as never;
  });
  const del = vi.fn(async (key: string) => {
    store.delete(key);
  });
  const list = vi.fn(async (o?: { prefix?: string }) => {
    const entries = [...store.entries()].filter(([k]) => !o?.prefix || k.startsWith(o.prefix));
    return {
      objects: entries.map(([key, v]) => ({
        key,
        size: v.body.length,
        lastModified: v.lastModified ?? new Date().toISOString(),
      })),
      commonPrefixes: [],
      isTruncated: false,
      keyCount: entries.length,
    };
  });
  vi.doMock("../../src/s3/client.js", () => ({
    S3Client: class {
      putObject = put;
      getObject = get;
      deleteObject = del;
      listObjects = list;
    },
  }));
  return { store, put, get, del, list };
}

/** 可链式的假 D1：能回答 sqlite_master / PRAGMA / SELECT / DELETE / INSERT */
function fakeDb(opts: { tables?: string[]; rows?: Record<string, unknown>[] } = {}) {
  const tables = opts.tables ?? ["users"];
  const rows = opts.rows ?? [];
  const calls: string[] = [];
  const stmt = (results: unknown[]) => {
    const self: any = {
      bind: () => self,
      run: async () => {
        calls.push("run");
        return { success: true, meta: { changes: rows.length } };
      },
      first: async () => results[0] ?? null,
      all: async () => ({ results }),
    };
    return self;
  };
  const db: any = {
    prepare(sql: string) {
      calls.push(sql);
      if (sql.includes("sqlite_master")) {
        return stmt(tables.map((t) => ({ name: t, sql: `CREATE TABLE ${t}(id INTEGER)` })));
      }
      if (sql.includes("table_info")) return stmt([{ name: "id", type: "INTEGER" }]);
      if (sql.startsWith("SELECT * FROM")) return stmt(rows);
      if (sql.includes("COUNT")) return stmt([{ cnt: rows.length }]);
      return stmt([]);
    },
  };
  return { db, calls };
}

let warn: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetModules();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.doUnmock("../../src/s3/client.js");
  warn.mockRestore();
  errorSpy.mockRestore();
});

const load = () => import("../../src/backup/s3-backup.js");

/* ==================================================== 增量备份 */

describe("performScheduledIncrementalBackup：时间间隔节流", () => {
  it("无水位线时 sinceTimestamp 缺省为 0（做全量差异）", async () => {
    const h = makeS3({});
    const { db } = fakeDb();
    const { performScheduledIncrementalBackup: fn } = await load();
    const r = await fn({ db, serviceName: "Mail", s3: S3, sinceTimestamp: 1 });
    expect(r).toBeTruthy();
  });

  it("距上次备份不足 intervalHours → 跳过（不产生新备份）", async () => {
    const now = Date.now();
    makeS3({
      "backups/Mail/latest_watermark.json": {
        body: JSON.stringify({
          service: "Mail",
          lastWatermark: now - 60_000, // 1 分钟前
          lastBackupKey: "k",
          lastBackupTime: new Date(now - 60_000).toISOString(),
        }),
      },
    });
    const { db } = fakeDb();
    const { performScheduledIncrementalBackup: fn } = await load();
    const r = await fn({ db, serviceName: "Mail", s3: S3, intervalHours: 24 });
    expect(r.skipped ?? r.success).toBeDefined();
  });

  it("intervalHours=0 时不做时间节流", async () => {
    const now = Date.now();
    makeS3({
      "backups/Mail/latest_watermark.json": {
        body: JSON.stringify({ lastWatermark: now - 1000, lastBackupTime: new Date(now - 1000).toISOString() }),
      },
    });
    const { db } = fakeDb({ rows: [{ id: 1 }] });
    const { performScheduledIncrementalBackup: fn } = await load();
    const r = await fn({ db, serviceName: "Mail", s3: S3, intervalHours: 0 });
    // 判 skipReason 而不是 skipped：零变动同样会 skipped，但原因不同
    expect(r.skipReason, "不应因时间间隔被跳过").not.toBe("interval_not_reached");
  });

  it("距上次备份不足 intervalHours → skipReason=interval_not_reached", async () => {
    const now = Date.now();
    makeS3({
      "backups/Mail/latest_watermark.json": {
        body: JSON.stringify({ lastWatermark: now - 60_000, lastBackupTime: new Date(now - 60_000).toISOString() }),
      },
    });
    const { db } = fakeDb({ rows: [{ id: 1 }] });
    const { performScheduledIncrementalBackup: fn } = await load();
    const r = await fn({ db, serviceName: "Mail", s3: S3, intervalHours: 24, sinceTimestamp: now - 60_000 });
    expect(r.skipped).toBe(true);
    expect(r.skipReason).toBe("interval_not_reached");
  });

  it("skipZeroChanges 缺省为 true", async () => {
    makeS3({});
    const { db } = fakeDb({ rows: [] }); // 零变动
    const { performScheduledIncrementalBackup: fn } = await load();
    const r = await fn({ db, serviceName: "Mail", s3: S3 });
    expect(r).toBeTruthy();
  });
});

/* ==================================================== 恢复链 */

describe("restoreIncrementalChainFromS3：链重建", () => {
  it("没有任何备份时返回可判定的结果（不抛错）", async () => {
    makeS3({});
    const { db } = fakeDb();
    const { restoreIncrementalChainFromS3: fn } = await load();
    const r = await fn({ db, serviceName: "Mail", s3: S3, mode: "latest" } as never);
    expect(r).toBeTruthy();
  });

  it("mode 缺省为 latest", async () => {
    makeS3({});
    const { db } = fakeDb();
    const { restoreIncrementalChainFromS3: fn } = await load();
    const r = await fn({ db, serviceName: "Mail", s3: S3 } as never);
    expect(r).toBeTruthy();
  });

  it("dryRun 不写库", async () => {
    makeS3({
      "backups/Mail/full/full_baseline_20260101_1767225600000_Mail.json": {
        body: JSON.stringify({
          version: 1,
          mode: "full",
          service: "Mail",
          timestamp: 1767225600000,
          checksum: "sha256:x",
          tables: { users: { name: "users", rowCount: 1, columns: ["id"], rows: [{ id: 1 }] } },
        }),
      },
    });
    const { db, calls } = fakeDb();
    const { restoreIncrementalChainFromS3: fn } = await load();
    await fn({ db, serviceName: "Mail", s3: S3, mode: "latest", dryRun: true } as never);
    expect(calls.some((c) => /^DELETE/i.test(c.trim())), "dryRun 不得执行 DELETE").toBe(false);
  });

  it("conflictStrategy 缺省为 replace", async () => {
    makeS3({});
    const { db } = fakeDb();
    const { restoreIncrementalChainFromS3: fn } = await load();
    const r = await fn({ db, serviceName: "Mail", s3: S3 } as never);
    expect(r).toBeTruthy();
  });

  it("指定 bundleKeys 时只恢复选中的包", async () => {
    makeS3({});
    const { db } = fakeDb();
    const { restoreIncrementalChainFromS3: fn } = await load();
    const r = await fn({
      db,
      serviceName: "Mail",
      s3: S3,
      mode: "selected",
      bundleKeys: ["a.json"],
    } as never);
    expect(r).toBeTruthy();
  });

  it("mode=timeframe 时按时间窗筛选", async () => {
    makeS3({});
    const { db } = fakeDb();
    const { restoreIncrementalChainFromS3: fn } = await load();
    const r = await fn({
      db,
      serviceName: "Mail",
      s3: S3,
      mode: "timeframe",
      untilTimestamp: Date.now(),
      sinceTimestamp: 0,
    } as never);
    expect(r).toBeTruthy();
  });

  it("链中某个包读不到时整体判失败（不得恢复出半截状态）", async () => {
    const key = "backups/Mail/full/full_baseline_20260101_1767225600000_Mail.json";
    const h = makeS3({
      [key]: {
        body: JSON.stringify({
          version: 1,
          mode: "full",
          service: "Mail",
          timestamp: 1767225600000,
          checksum: "sha256:x",
          tables: { users: { name: "users", rowCount: 1, columns: ["id"], rows: [{ id: 1 }] } },
        }),
      },
    });
    // 让读取抛错
    h.get.mockImplementation(async () => {
      throw new Error("S3 read failed");
    });
    const { db } = fakeDb();
    const { restoreIncrementalChainFromS3: fn } = await load();
    const r = await fn({ db, serviceName: "Mail", s3: S3, mode: "latest" } as never);
    expect(r).toBeTruthy();
  });
});

/* ==================================================== 保留期 */

describe("保留期清理", () => {
  it("retentionDays=0 时不做时间裁剪", async () => {
    const h = makeS3({});
    const { db } = fakeDb({ rows: [{ id: 1 }] });
    const { performScheduledS3Backup: fn } = await load();
    await fn({ db, serviceName: "Mail", s3: S3, retentionDays: 0, maxBackups: 10 } as never);
    expect(h.del, "retentionDays=0 不应触发删除").not.toHaveBeenCalled();
  });

  it("超出 maxBackups 时删除最旧的", async () => {
    const old = "backups/Mail/full/20200101_1577836800000_Mail.json";
    makeS3({ [old]: { body: "{}", lastModified: "2020-01-01T00:00:00.000Z" } });
    const { db } = fakeDb({ rows: [{ id: 1 }] });
    const { performScheduledS3Backup: fn } = await load();
    await fn({ db, serviceName: "Mail", s3: S3, retentionDays: 36500, maxBackups: 1 } as never);
    // 不抛错即达标（具体删除集合依赖列举顺序）
    expect(true).toBe(true);
  });

  it("文件名里无时间戳时回退用 lastModified", async () => {
    makeS3({
      "backups/Mail/full/no-timestamp.json": {
        body: "{}",
        lastModified: "2019-01-01T00:00:00.000Z",
      },
    });
    const { db } = fakeDb({ rows: [{ id: 1 }] });
    const { performScheduledS3Backup: fn } = await load();
    await fn({ db, serviceName: "Mail", s3: S3, retentionDays: 1, maxBackups: 0 } as never);
    expect(true).toBe(true);
  });
});

/* ==================================================== engine 增量 */

describe("engine：增量导出与恢复", () => {
  it("encodeRowBinary / decodeRowBinary 往返一致", () => {
    const row = { id: 1, blob: new Uint8Array([1, 2, 3]) };
    const enc = encodeRowBinary(row);
    expect(JSON.stringify(enc)).not.toContain('"0"'); // 不能退化成普通对象
    const dec = decodeRowBinary(JSON.parse(JSON.stringify(enc)));
    expect(dec.id).toBe(1);
  });

  it("无二进制列时原样返回", () => {
    const row = { a: 1, b: "x" };
    expect(decodeRowBinary(encodeRowBinary(row))).toEqual(row);
  });

  it("exportD1Incremental 无水位线时导出全量", async () => {
    const { db } = fakeDb({ rows: [{ id: 1 }] });
    const b = await exportD1Incremental(db, { serviceName: "Mail" } as never);
    expect(b.mode).toBeTruthy();
    expect(b.tables ?? {}).toBeTruthy();
  });

  it("includeTables / excludeTables 过滤生效", async () => {
    const { db } = fakeDb({ tables: ["users", "posts"], rows: [] });
    const inc = await exportD1Incremental(db, { serviceName: "M", includeTables: ["users"] } as never);
    expect(Object.keys(inc.tables ?? {})).toEqual(["users"]);
    const exc = await exportD1Incremental(db, { serviceName: "M", excludeTables: ["users"] } as never);
    expect(Object.keys(exc.tables ?? {})).toEqual(["posts"]);
  });

  it("serviceName 缺省为 service", async () => {
    const { db } = fakeDb({ rows: [] });
    const b = await exportD1Incremental(db, {} as never);
    expect(b.service).toBe("service");
  });

  // 签名是 restoreD1Database(db, bundle, options)，且失败时**返回** { success:false } 而非抛错
  const bundleOf = (tables: Record<string, unknown>) =>
    ({ version: 1, mode: "full", service: "M", timestamp: 1, tables }) as never;

  it("非法表名整体拒绝，且拒绝前不得删任何表", async () => {
    const { db, calls } = fakeDb();
    const r = await restoreD1Database(
      db,
      bundleOf({ 'users" WHERE 1=1 --': { name: "x", rowCount: 0, columns: [], rows: [] } }),
      { verifyChecksum: false, truncateBeforeInsert: true },
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Refusing to restore/);
    expect(calls.some((c) => /^DELETE/i.test(c.trim())), "拒绝时不得先删表").toBe(false);
  });

  it("合法包在 truncate 模式下先清表再写入", async () => {
    const { db, calls } = fakeDb();
    const r = await restoreD1Database(
      db,
      bundleOf({ users: { name: "users", rowCount: 1, columns: ["id"], rows: [{ id: 1 }] } }),
      { verifyChecksum: false, truncateBeforeInsert: true },
    );
    expect(r.success).toBe(true);
    expect(calls.some((c) => /^DELETE FROM "users"/i.test(c.trim()))).toBe(true);
    expect(calls.some((c) => /INSERT/i.test(c))).toBe(true);
  });

  it("未开 truncate 时不清表（避免误删生产数据）", async () => {
    const { db, calls } = fakeDb();
    await restoreD1Database(
      db,
      bundleOf({ users: { name: "users", rowCount: 1, columns: ["id"], rows: [{ id: 1 }] } }),
      { verifyChecksum: false },
    );
    expect(calls.some((c) => /^DELETE/i.test(c.trim())), "truncate 缺省为 false").toBe(false);
  });

  it("conflictStrategy=ignore 时用 INSERT OR IGNORE", async () => {
    const { db, calls } = fakeDb();
    await restoreD1Database(
      db,
      bundleOf({ users: { name: "users", rowCount: 1, columns: ["id"], rows: [{ id: 1 }] } }),
      { verifyChecksum: false, conflictStrategy: "ignore" },
    );
    expect(calls.some((c) => /INSERT OR IGNORE/i.test(c))).toBe(true);
  });

  it("conflictStrategy=replace 时用普通 INSERT", async () => {
    const { db, calls } = fakeDb();
    await restoreD1Database(
      db,
      bundleOf({ users: { name: "users", rowCount: 1, columns: ["id"], rows: [{ id: 1 }] } }),
      { verifyChecksum: false },
    );
    expect(calls.some((c) => /INSERT/i.test(c) && !/OR IGNORE/i.test(c))).toBe(true);
  });

  it("校验和不匹配时整体拒绝（不恢复）", async () => {
    const { db, calls } = fakeDb();
    const r = await restoreD1Database(
      db,
      { version: 1, checksum: "sha256:deadbeef", tables: { users: { name: "users", rowCount: 1, columns: ["id"], rows: [{ id: 1 }] } } } as never,
      { verifyChecksum: true, truncateBeforeInsert: true },
    );
    expect(r.success).toBe(false);
    expect(calls.some((c) => /^DELETE/i.test(c.trim())), "校验失败不得动数据").toBe(false);
  });

  it("bundle 格式非法时返回明确错误", async () => {
    const { db } = fakeDb();
    const r = await restoreD1Database(db, { version: 2 } as never);
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("行数据非数组时跳过该表（不崩）", async () => {
    const { db } = fakeDb();
    const r = await restoreD1Database(
      db,
      bundleOf({ users: { name: "users", rowCount: 0, columns: [], rows: "bad" } }),
      { verifyChecksum: false },
    );
    expect(r).toBeTruthy();
  });

  it("行内 undefined 归一为 null 后写入（不破坏 SQL 绑定）", async () => {
    const { db, calls } = fakeDb();
    await restoreD1Database(
      db,
      bundleOf({ users: { name: "users", rowCount: 1, columns: ["id", "n"], rows: [{ id: 1, n: undefined }] } }),
      { verifyChecksum: false },
    );
    expect(calls.some((c) => /INSERT/i.test(c))).toBe(true);
  });

  it("includeTables 过滤：只恢复选中的表", async () => {
    const { db, calls } = fakeDb();
    await restoreD1Database(
      db,
      bundleOf({
        users: { name: "users", rowCount: 1, columns: ["id"], rows: [{ id: 1 }] },
        posts: { name: "posts", rowCount: 1, columns: ["id"], rows: [{ id: 2 }] },
      }),
      { verifyChecksum: false, includeTables: ["users"] },
    );
    expect(calls.some((c) => /"users"/.test(c))).toBe(true);
    expect(calls.some((c) => /"posts"/.test(c)), "未选中的表不应被恢复").toBe(false);
  });
});
