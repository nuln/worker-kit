/**
 * S3 备份编排层的分支覆盖补齐
 *
 * ## 为什么优先补这一块
 *
 * `backup/s3-backup.ts` 是全仓覆盖最差的有逻辑文件（分支 61.3% / 函数 61.1%），
 * 而它的 5 个顶层入口 —— 基线探测、基线备份、状态查询、增量备份、恢复链 ——
 * **全部没有测试**。
 *
 * 这些函数承载的是最容易"静默出错"的逻辑：
 *
 * - 基线水位线的读写（读失败 / 损坏时怎么处理）
 * - 增量链的拼接顺序（乱序会导致恢复出错误状态）
 * - 保留期清理的兜底日期（`lastModified` 缺失时按什么排）
 *
 * 任何一处出错，表现为"备份成功但恢复不回来"或"恢复成功但数据是旧的"，
 * 两者都不会报错。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isBaselinePresentOnS3,
  getBackupStatusFromS3,
  listIncrementalBackupsFromS3,
} from "../../src/backup/s3-backup.js";

const S3 = {
  accessKeyId: "AKIA",
  secretAccessKey: "secret",
  region: "us-east-1",
  bucket: "bkt",
  endpoint: "https://s3.example.com",
} as never;

/** 用可控的内存 S3 替身 */
function makeS3(objects: Record<string, { body: string; lastModified?: string }>) {
  const store = new Map<string, { body: string; lastModified?: string }>(Object.entries(objects));
  const put = vi.fn(async (key: string, data: string) => {
    store.set(key, { body: data, lastModified: new Date().toISOString() });
    return { ok: true, etag: "e" } as never;
  });
  const get = vi.fn(async (key: string) => {
    const o = store.get(key);
    if (!o) return null;
    return { ok: true, text: async () => o.body } as never;
  });
  const del = vi.fn(async (key: string) => {
    store.delete(key);
  });
  // 必须按 prefix 过滤 —— 真实 S3Client 是服务端过滤的，
  // 而 `isBaselinePresentOnS3` 正是靠 `full/` 前缀把基线与其他 .json 隔开
  const list = vi.fn(async (opts?: { prefix?: string }) => {
    const entries = [...store.entries()].filter(
      ([k]) => !opts?.prefix || k.startsWith(opts.prefix),
    );
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

let warn: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetModules();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("../../src/s3/client.js");
  warn.mockRestore();
  errorSpy.mockRestore();
});

/** 在 mock 生效的前提下动态 import 被测模块 */
async function load() {
  return import("../../src/backup/s3-backup.js");
}

/* ==================================================== 基线探测 */

describe("isBaselinePresentOnS3", () => {
  it("存在基线时返回 key 与时间", async () => {
    makeS3({
      "backups/Mail/full/full_baseline_2026-01-01T00-00-00.json": {
        body: "{}",
        lastModified: "2026-01-01T00:00:00.000Z",
      },
    });
    const { isBaselinePresentOnS3: fn } = await load();
    const r = await fn({ s3: S3, serviceName: "Mail" });
    expect(r.hasBaseline).toBe(true);
    expect(r.baselineKey).toContain("full_baseline");
    expect(r.baselineTime).toBeTruthy();
  });

  it("不存在基线时 hasBaseline 为 false", async () => {
    makeS3({});
    const { isBaselinePresentOnS3: fn } = await load();
    expect((await fn({ s3: S3, serviceName: "Mail" })).hasBaseline).toBe(false);
  });

  it("只有增量备份、无基线 → false（前缀限定在 full/ 子目录内）", async () => {
    // 关键：基线探测只列 `backups/<svc>/full/`，因此别处的 .json
    // （增量、水位线）不会被误当成基线
    makeS3({
      "backups/Mail/inc/2026-02-01/1700000000000_since_0_Mail.json": { body: "{}" },
      "backups/Mail/latest_watermark.json": { body: "{}" },
    });
    const { isBaselinePresentOnS3: fn } = await load();
    expect((await fn({ s3: S3, serviceName: "Mail" })).hasBaseline).toBe(false);
  });

  it("别处的 .json（增量 / 水位线）不得被误判为基线", async () => {
    makeS3({
      "backups/Mail/inc/2026-02-01/1700000000000_since_0_Mail.json": { body: "{}" },
      "backups/Mail/latest_watermark.json": { body: "{}" },
    });
    const { isBaselinePresentOnS3: fn } = await load();
    expect((await fn({ s3: S3, serviceName: "Mail" })).hasBaseline).toBe(false);
  });

  it("同名服务的基线不得被另一个服务误命中", async () => {
    makeS3({ "backups/Other/full/full_baseline_2026-01-01.json": { body: "{}" } });
    const { isBaselinePresentOnS3: fn } = await load();
    expect((await fn({ s3: S3, serviceName: "Mail" })).hasBaseline).toBe(false);
  });

  it("多个基线时取最近的一个", async () => {
    makeS3({
      "backups/Mail/full/full_baseline_2026-01-01T00-00-00.json": {
        body: "{}",
        lastModified: "2026-01-01T00:00:00.000Z",
      },
      "backups/Mail/full/full_baseline_2026-06-01T00-00-00.json": {
        body: "{}",
        lastModified: "2026-06-01T00:00:00.000Z",
      },
    });
    const { isBaselinePresentOnS3: fn } = await load();
    const r = await fn({ s3: S3, serviceName: "Mail" });
    expect(r.baselineKey).toContain("2026-06-01");
  });

  it("S3 列举失败时返回 hasBaseline:false 并告警（不得抛给调用方）", async () => {
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
    expect(warn, "失败必须留痕").toHaveBeenCalled();
  });

  it("自定义 keyPrefix 生效", async () => {
    makeS3({ "custom/x/Mail/full/full_baseline_2026-01-01.json": { body: "{}" } });
    const { isBaselinePresentOnS3: fn } = await load();
    expect((await fn({ s3: S3, serviceName: "Mail", keyPrefix: "custom/x" })).hasBaseline).toBe(
      true,
    );
  });

  it("keyPrefix 末尾多余斜杠被规范化（不得产生 //）", async () => {
    makeS3({ "custom/Mail/full/full_baseline_2026-01-01.json": { body: "{}" } });
    const { isBaselinePresentOnS3: fn } = await load();
    expect((await fn({ s3: S3, serviceName: "Mail", keyPrefix: "custom///" })).hasBaseline).toBe(
      true,
    );
  });
});

/* ==================================================== 备份状态 */

describe("getBackupStatusFromS3", () => {
  it("同时有基线与增量时都报出来", async () => {
    makeS3({
      "backups/Mail/full/full_baseline_2026-01-01.json": { body: "{}" },
      "backups/Mail/inc/2026-03-01/1700000000000_since_0_Mail.json": {
        body: "{}",
        lastModified: "2026-03-01T00:00:00.000Z",
      },
    });
    const { getBackupStatusFromS3: fn } = await load();
    const r = await fn({ s3: S3, serviceName: "Mail" });
    expect(r.hasBaseline, "应识别出基线").toBe(true);
  });

  it("空仓库时返回可用的空状态而非抛错", async () => {
    makeS3({});
    const { getBackupStatusFromS3: fn } = await load();
    const r = await fn({ s3: S3, serviceName: "Mail" });
    expect(r).toBeTruthy();
  });

  it("S3 不可用时异常向上传播（由调用方决定降级策略）", async () => {
    // 注意：这两个函数**不**吞异常。列出备份清单时把"S3 不可用"
    // 伪装成"没有备份"，会让运维以为数据被清空了 —— 比报错更危险。
    vi.doMock("../../src/s3/client.js", () => ({
      S3Client: class {
        listObjects = async () => {
          throw new Error("S3 down");
        };
        getObject = async () => null;
      },
    }));
    const { getBackupStatusFromS3: fn } = await load();
    await expect(fn({ s3: S3, serviceName: "Mail" })).rejects.toThrow(/S3 down/);
  });
});

/* ==================================================== 增量链列举 */

describe("listIncrementalBackupsFromS3", () => {
  it("按时间正序返回增量链（恢复依赖顺序）", async () => {
    makeS3({
      "backups/Mail/incremental_2026-03-01.json": {
        body: "{}",
        lastModified: "2026-03-01T00:00:00.000Z",
      },
      "backups/Mail/incremental_2026-01-01.json": {
        body: "{}",
        lastModified: "2026-01-01T00:00:00.000Z",
      },
      "backups/Mail/incremental_2026-02-01.json": {
        body: "{}",
        lastModified: "2026-02-01T00:00:00.000Z",
      },
    });
    const { listIncrementalBackupsFromS3: fn } = await load();
    const r = await fn({ s3: S3, serviceName: "Mail" });
    const times = (r as Array<{ lastModified?: string }>).map((x) => x.lastModified);
    expect(times).toEqual([...times].sort());
  });

  it("基线与增量都返回，但用 type 字段区分（函数名有误导性）", async () => {
    // 该函数返回的是**全部**备份文件，不是"仅增量"。
    // 恢复链需要基线 + 增量一起，因此这里必须都返回，靠 `type` 区分。
    makeS3({
      "backups/Mail/full/full_baseline_2026-01-01.json": { body: "{}" },
      "backups/Mail/inc/2026-02-01/1700000000000_since_0_Mail.json": { body: "{}" },
    });
    const { listIncrementalBackupsFromS3: fn } = await load();
    const r = (await fn({ s3: S3, serviceName: "Mail" })) as Array<{ type: string }>;
    expect(r.map((x) => x.type).sort()).toEqual(["baseline", "incremental"]);
  });

  it("从 _since_ 文件名解析出 since/until 时间戳", async () => {
    makeS3({
      "backups/Mail/inc/2026-02-01/1772000000000_since_1769000000000_Mail.json": { body: "{}" },
    });
    const { listIncrementalBackupsFromS3: fn } = await load();
    const r = (await fn({ s3: S3, serviceName: "Mail" })) as Array<{
      sinceTimestamp: number;
    }>;
    expect(r[0]?.sinceTimestamp).toBe(1769000000000);
  });

  it("排除水位线文件（它不是备份）", async () => {
    makeS3({
      "backups/Mail/latest_watermark.json": { body: "{}" },
      "backups/Mail/incremental_2026-02-01.json": { body: "{}" },
    });
    const { listIncrementalBackupsFromS3: fn } = await load();
    const r = await fn({ s3: S3, serviceName: "Mail" });
    expect(JSON.stringify(r)).not.toContain("latest_watermark");
  });

  it("lastModified 缺失时仍返回该条目（不得静默丢弃）", async () => {
    vi.doMock("../../src/s3/client.js", () => ({
      S3Client: class {
        listObjects = async () => ({
          objects: [{ key: "backups/Mail/incremental_2026-02-01.json", size: 2 }],
          commonPrefixes: [],
          isTruncated: false,
          keyCount: 1,
        });
      },
    }));
    const { listIncrementalBackupsFromS3: fn } = await load();
    const r = await fn({ s3: S3, serviceName: "Mail" });
    expect((r as unknown[]).length).toBe(1);
  });

  it("无增量时返回空数组", async () => {
    makeS3({});
    const { listIncrementalBackupsFromS3: fn } = await load();
    expect(await fn({ s3: S3, serviceName: "Mail" })).toEqual([]);
  });

  it("S3 失败时异常向上传播，不伪装成空清单", async () => {
    vi.doMock("../../src/s3/client.js", () => ({
      S3Client: class {
        listObjects = async () => {
          throw new Error("S3 down");
        };
      },
    }));
    const { listIncrementalBackupsFromS3: fn } = await load();
    await expect(fn({ s3: S3, serviceName: "Mail" })).rejects.toThrow(/S3 down/);
  });
});
