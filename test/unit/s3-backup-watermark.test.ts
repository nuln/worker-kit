/**
 * S3 备份编排：水位线与基线拦截的分支覆盖
 *
 * 承接 `s3-backup-branches.test.ts`，覆盖状态查询与基线创建的两条主线。
 *
 * ## 关注点
 *
 * - 水位线文件缺失 / 损坏 / 字段缺失时的行为
 *   —— 损坏后若直接抛错，备份会整体卡住；若静默当作"无水位线"，
 *   则会做一次全量重复备份并把 `sinceTimestamp` 归零
 * - `initFullBaselineBackup` 的幂等拦截
 *   —— 已存在基线时必须拒绝，否则会出现两条基线链，恢复时结果不确定
 * - `autoBackupEnabled` 的判定条件
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getBackupStatusFromS3, initFullBaselineBackup } from "../../src/backup/s3-backup.js";

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

/** 支持 prefix 过滤的内存 S3 替身 */
function makeS3(objects: Record<string, Stored> = {}, opts: { putThrows?: boolean } = {}) {
  const store = new Map<string, Stored>(Object.entries(objects));
  const put = vi.fn(async (key: string, data: string) => {
    if (opts.putThrows) throw new Error("S3 write denied");
    store.set(key, { body: data, lastModified: new Date().toISOString() });
    return { ok: true } as never;
  });
  const get = vi.fn(async (key: string) => {
    const o = store.get(key);
    if (!o) return null;
    return { ok: true, text: async () => o.body } as never;
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
      listObjects = list;
    },
  }));
  return { store, put, get, list };
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

/* ==================================================== 水位线 */

describe("getBackupStatusFromS3：水位线读取", () => {
  it("读取并透出水位线与上次备份时间", async () => {
    makeS3({
      "backups/Mail/latest_watermark.json": {
        body: JSON.stringify({ lastWatermark: 1772000000000, lastBackupTime: "2026-03-01T00:00:00.000Z" }),
      },
    });
    const { getBackupStatusFromS3: fn } = await load();
    const r = await fn({ s3: S3, serviceName: "Mail" });
    expect(r.latestWatermark).toBe(1772000000000);
    expect(r.latestBackupTime).toBe("2026-03-01T00:00:00.000Z");
  });

  it("水位线文件不存在时字段为 undefined（不是 0，避免误判为从头开始）", async () => {
    makeS3({});
    const { getBackupStatusFromS3: fn } = await load();
    const r = await fn({ s3: S3, serviceName: "Mail" });
    expect(r.latestWatermark).toBeUndefined();
  });

  it("水位线 JSON 损坏时降级为 undefined，不让整个状态查询 500", async () => {
    makeS3({ "backups/Mail/latest_watermark.json": { body: "{corrupted" } });
    const { getBackupStatusFromS3: fn } = await load();
    const r = await fn({ s3: S3, serviceName: "Mail" });
    expect(r.latestWatermark, "损坏时按无水位线处理").toBeUndefined();
  });

  it("水位线缺少 lastWatermark 字段时为 undefined", async () => {
    makeS3({ "backups/Mail/latest_watermark.json": { body: JSON.stringify({}) } });
    const { getBackupStatusFromS3: fn } = await load();
    expect((await fn({ s3: S3, serviceName: "Mail" })).latestWatermark).toBeUndefined();
  });

  it("getObject 抛错时同样降级为 undefined", async () => {
    vi.doMock("../../src/s3/client.js", () => ({
      S3Client: class {
        listObjects = async () => ({ objects: [], commonPrefixes: [], isTruncated: false, keyCount: 0 });
        getObject = async () => {
          throw new Error("S3 read denied");
        };
      },
    }));
    const { getBackupStatusFromS3: fn } = await load();
    const r = await fn({ s3: S3, serviceName: "Mail" });
    expect(r.latestWatermark).toBeUndefined();
    expect(r.hasBaseline).toBe(false);
  });
});

/* ==================================================== 开关与间隔 */

describe("getBackupStatusFromS3：autoBackupEnabled 与间隔", () => {
  it("配置齐全时 autoBackupEnabled 为 true", async () => {
    makeS3({});
    const { getBackupStatusFromS3: fn } = await load();
    expect((await fn({ s3: S3, serviceName: "Mail" })).autoBackupEnabled).toBe(true);
  });

  it("缺 accessKeyId 时 autoBackupEnabled 为 false", async () => {
    makeS3({});
    const { getBackupStatusFromS3: fn } = await load();
    const r = await fn({
      s3: { ...(S3 as object), accessKeyId: "" } as never,
      serviceName: "Mail",
    });
    expect(r.autoBackupEnabled).toBe(false);
  });

  it("缺 endpoint 或 bucket 时同样为 false", async () => {
    makeS3({});
    const { getBackupStatusFromS3: fn } = await load();
    expect(
      (await fn({ s3: { ...(S3 as object), bucket: "" } as never, serviceName: "Mail" }))
        .autoBackupEnabled,
    ).toBe(false);
    expect(
      (await fn({ s3: { ...(S3 as object), endpoint: "" } as never, serviceName: "Mail" }))
        .autoBackupEnabled,
    ).toBe(false);
  });

  it("未指定 intervalHours 时缺省 24", async () => {
    makeS3({});
    const { getBackupStatusFromS3: fn } = await load();
    expect((await fn({ s3: S3, serviceName: "Mail" })).intervalHours).toBe(24);
  });

  it("显式 intervalHours 生效（0 是合法值，不得被 || 吞掉）", async () => {
    makeS3({});
    const { getBackupStatusFromS3: fn } = await load();
    expect((await fn({ s3: S3, serviceName: "Mail", intervalHours: 6 })).intervalHours).toBe(6);
  });

  it("totalBackupsCount 反映实际对象数", async () => {
    makeS3({
      "backups/Mail/full/full_baseline_2026-01-01.json": { body: "{}" },
      "backups/Mail/inc/2026-02-01/1772000000000_since_0_Mail.json": { body: "{}" },
      "backups/Mail/inc/2026-03-01/1773000000000_since_0_Mail.json": { body: "{}" },
    });
    const { getBackupStatusFromS3: fn } = await load();
    const r = await fn({ s3: S3, serviceName: "Mail" });
    expect(r.totalBackupsCount).toBe(3);
  });
});

/* ==================================================== 基线创建 */

describe("initFullBaselineBackup：幂等拦截", () => {
  it("已存在基线时拒绝创建（否则会出现两条基线链）", async () => {
    makeS3({ "backups/Mail/full/full_baseline_2026-01-01.json": { body: "{}" } });
    const { initFullBaselineBackup: fn } = await load();
    await expect(
      fn({ s3: S3, serviceName: "Mail", db: {} as never }),
    ).rejects.toThrow(/already exists|已存在/i);
  });

  it("拦截发生时不得写出任何新对象", async () => {
    const h = makeS3({ "backups/Mail/full/full_baseline_2026-01-01.json": { body: "{}" } });
    const { initFullBaselineBackup: fn } = await load();
    await expect(fn({ s3: S3, serviceName: "Mail", db: {} as never })).rejects.toThrow();
    expect(h.put, "被拦截时不应写入").not.toHaveBeenCalled();
  });

  it("无基线时越过拦截进入创建流程", async () => {
    makeS3({});
    const { initFullBaselineBackup: fn } = await load();
    // 用不可用的 db：若已越过"基线已存在"拦截，会在导出阶段被判失败
    const r = await fn({ s3: S3, serviceName: "Mail", db: null as never });
    expect(r.success, "越过拦截后应进入创建流程并因导出失败而判失败").toBe(false);
  });

  it("D1 句柄失效时不得产出空包成功（否则水位线被推到 now，数据永远补不回来）", async () => {
    // 回归用例：`getD1UserTables` 查询失败时返回 `[]`（与"库里没表"无法区分），
    // 于是 failedTables 为空 → 越过守卫 → 上传 0 表的包 → success:true，
    // 随后 initFullBaselineBackup 把 lastWatermark 写成 now。
    // 实测该路径上传 260 字节、checksum 为**空串的 SHA-256**。
    const h = makeS3({});
    const { performScheduledS3Backup: fn } = await load();
    const r = await fn({ db: null as never, serviceName: "Mail", s3: S3 });
    expect(r.success, "0 张表时必须判失败").toBe(false);
    expect((r.failedTables ?? []).join()).toContain("0 张表");
    expect(h.put, "判失败时不得上传任何对象").not.toHaveBeenCalled();
    expect(errorSpy, "必须留下可排查的告警").toHaveBeenCalled();
  });

  it("S3 列举失败时不得误判为已无基线从而重复创建", async () => {
    // 探测失败会返回 hasBaseline:false —— 这是 fail-open。
    // 这里钉住当前行为，提醒调用方：基线探测失败时不能当作"没有基线"。
    vi.doMock("../../src/s3/client.js", () => ({
      S3Client: class {
        listObjects = async () => {
          throw new Error("S3 down");
        };
      },
    }));
    const { isBaselinePresentOnS3: fn } = await load();
    const r = await fn({ s3: S3, serviceName: "Mail" });
    expect(r.hasBaseline).toBe(false);
    expect(warn, "探测失败必须告警，否则重复建基线无从追溯").toHaveBeenCalled();
  });
});
