import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  exportD1Database,
  exportD1Incremental,
  restoreD1Database,
  getTableColumns,
  getD1UserTables,
} from "../src/backup/engine.js";
import {
  performScheduledS3Backup,
  performScheduledIncrementalBackup,
  listIncrementalBackupsFromS3,
  restoreIncrementalChainFromS3,
} from "../src/backup/s3-backup.js";

function createErrorProneDb(opts: {
  tableError?: boolean;
  pragmaError?: boolean;
  insertError?: boolean;
  customData?: Record<string, any[]>;
} = {}) {
  const data: Record<string, any[]> = opts.customData || {
    users: [{ id: "u1", name: "Alice", updated_at: 1000 }],
  };

  return {
    _data: data,
    prepare(sql: string) {
      if (opts.tableError && sql.includes("SELECT * FROM")) {
        throw new Error("Disk I/O failure on SELECT");
      }
      if (opts.pragmaError && sql.includes("PRAGMA table_info")) {
        throw new Error("PRAGMA error");
      }
      return {
        bind(...params: any[]) {
          return {
            async run() {
              if (opts.insertError && sql.startsWith("INSERT")) {
                throw new Error("Constraint violation");
              }
              return { success: true };
            },
            async all() {
              if (opts.tableError) {
                throw new Error("Database query failed");
              }
              const match = sql.match(/FROM\s+"?([^"\s]+)"?/i);
              const tbl = match ? match[1] : "";
              return { results: data[tbl] || [] };
            },
          };
        },
        async all() {
          if (opts.pragmaError && sql.includes("PRAGMA table_info")) {
            throw new Error("PRAGMA failure");
          }
          if (sql.includes("sqlite_master")) {
            return { results: Object.keys(data).map((name) => ({ name })) };
          }
          if (sql.includes("PRAGMA table_info")) {
            const match = sql.match(/PRAGMA table_info\("?([^"\s]+)"?\)/i);
            const tbl = match ? match[1] : "";
            const firstRow = data[tbl]?.[0] || {};
            return { results: Object.keys(firstRow).map((c) => ({ name: c })) };
          }
          const match = sql.match(/FROM\s+"?([^"\s]+)"?/i);
          const tbl = match ? match[1] : "";
          return { results: data[tbl] || [] };
        },
        async run() {
          return { success: true };
        },
      };
    },
  };
}

describe("@nuln/worker-kit/backup - Deep Branch & Edge Case Coverage", () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("getTableColumns and getD1UserTables handle PRAGMA and SQLite internal filters", async () => {
    const db = createErrorProneDb({ pragmaError: true });
    const cols = await getTableColumns(db, "users");
    expect(cols).toEqual([]);

    const normalDb = createErrorProneDb({
      customData: {
        users: [{ id: 1, email: "a@a.com" }],
        sqlite_stat1: [{ a: 1 }],
        d1_kv: [{ k: 1 }],
        _cf_METADATA: [{ m: 1 }],
      },
    });
    const userTables = await getD1UserTables(normalDb);
    expect(userTables).toEqual(["users"]);
  });

  it("exportD1Database handles table dump errors gracefully", async () => {
    const db = createErrorProneDb({ tableError: true });
    const bundle = await exportD1Database(db, { serviceName: "err-service" });
    expect(bundle.service).toBe("err-service");
    expect(bundle.tables["users"]).toBeUndefined();
  });

  it("exportD1Incremental handles error branches and table failures", async () => {
    const db = createErrorProneDb({ tableError: true });
    const bundle = await exportD1Incremental(db, {
      serviceName: "err-service",
      sinceTimestamp: 500,
    });
    expect(bundle.tables["users"]).toBeUndefined();
  });

  it("restoreD1Database handles insert failures and batch execution without db.batch", async () => {
    const db = createErrorProneDb({ insertError: true });
    const bundle = {
      version: 1 as const,
      service: "test",
      timestamp: Date.now(),
      createdAt: new Date().toISOString(),
      checksum: "",
      tables: {
        users: {
          name: "users",
          rowCount: 1,
          columns: ["id"],
          rows: [{ id: "u1" }],
        },
      },
    };
    const { sha256Hex } = await import("../src/s3/sigv4.js");
    bundle.checksum = `sha256:${await sha256Hex(JSON.stringify(bundle.tables))}`;

    const res = await restoreD1Database(db, bundle);
    expect(res.success).toBe(false);
    expect(res.error).toContain("Constraint violation");
  });

  it("performScheduledIncrementalBackup cleans up expired incremental objects and enforces maxBackups", async () => {
    const db = createErrorProneDb();

    // 1. GET watermark returns valid timestamp
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ lastWatermark: 100 }), { status: 200 }));
    // 2. PUT targetKey
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
    // 3. PUT latest_watermark.json
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

    // 4. LIST returns an expired object and 3 excess objects for maxBackups = 1
    const oldTimestamp = Date.now() - 40 * 24 * 3600 * 1000;
    const recentTimestamp1 = Date.now() - 2 * 3600 * 1000;
    const recentTimestamp2 = Date.now() - 1 * 3600 * 1000;
    const listXml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Contents>
    <Key>backups/mail/inc/2026-08-01/${oldTimestamp}_since_0_mail.json</Key>
    <LastModified>2026-08-01T00:00:00.000Z</LastModified>
  </Contents>
  <Contents>
    <Key>backups/mail/inc/2026-09-17/${recentTimestamp1}_since_100_mail.json</Key>
    <LastModified>2026-09-17T00:00:00.000Z</LastModified>
  </Contents>
  <Contents>
    <Key>backups/mail/inc/2026-09-17/${recentTimestamp2}_since_200_mail.json</Key>
    <LastModified>2026-09-17T01:00:00.000Z</LastModified>
  </Contents>
</ListBucketResult>`;
    mockFetch.mockResolvedValueOnce(new Response(listXml, { status: 200 }));
    // DELETE requests
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));

    const res = await performScheduledIncrementalBackup({
      db,
      serviceName: "mail",
      retentionDays: 30,
      maxBackups: 1,
      s3: {
        endpoint: "https://r2.cloudflarestorage.com",
        bucket: "backups",
        accessKeyId: "ak",
        secretAccessKey: "sk",
      },
    });

    expect(res.success).toBe(true);
    expect(res.deletedKeys.length).toBeGreaterThanOrEqual(2);
  });

  it("restoreIncrementalChainFromS3 handles empty chain, missing S3 object and bundle restore error", async () => {
    const db = createErrorProneDb();

    // 1. Empty chain
    mockFetch.mockResolvedValueOnce(new Response("<ListBucketResult></ListBucketResult>", { status: 200 }));
    const emptyRes = await restoreIncrementalChainFromS3({
      db,
      serviceName: "mail",
      s3: { endpoint: "https://r2.cloudflarestorage.com", bucket: "b", accessKeyId: "ak", secretAccessKey: "sk" },
    });
    expect(emptyRes.success).toBe(true);
    expect(emptyRes.appliedBundlesCount).toBe(0);

    // 2. Missing S3 object (404)
    const listXml = `<ListBucketResult><Contents><Key>backups/mail/inc/2026-09-17/1000_since_0_mail.json</Key></Contents></ListBucketResult>`;
    mockFetch.mockResolvedValueOnce(new Response(listXml, { status: 200 })); // LIST
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 })); // GET 404
    const notFoundRes = await restoreIncrementalChainFromS3({
      db,
      serviceName: "mail",
      s3: { endpoint: "https://r2.cloudflarestorage.com", bucket: "b", accessKeyId: "ak", secretAccessKey: "sk" },
    });
    expect(notFoundRes.success).toBe(false);
    expect(notFoundRes.error).toContain("404");

    // 3. Bundle restore failure in D1
    const failingDb = createErrorProneDb({ insertError: true });
    const { sha256Hex } = await import("../src/s3/sigv4.js");
    const testTables = { users: { name: "users", rowCount: 1, columns: ["id"], rows: [{ id: 1 }] } };
    const validChecksum = `sha256:${await sha256Hex(JSON.stringify(testTables))}`;
    const bundle = {
      version: 1 as const,
      mode: "incremental" as const,
      service: "mail",
      sinceTimestamp: 0,
      untilTimestamp: 1000,
      timestamp: 1000,
      createdAt: new Date().toISOString(),
      totalChangedRows: 1,
      checksum: validChecksum,
      tables: testTables,
    };
    mockFetch.mockResolvedValueOnce(new Response(listXml, { status: 200 })); // LIST
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(bundle), { status: 200 })); // GET
    const failRestore = await restoreIncrementalChainFromS3({
      db: failingDb,
      serviceName: "mail",
      s3: { endpoint: "https://r2.cloudflarestorage.com", bucket: "b", accessKeyId: "ak", secretAccessKey: "sk" },
    });
    expect(failRestore.success).toBe(false);
    expect(failRestore.error).toContain("Constraint violation");
  });

  it("performScheduledS3Backup handles retention expiration, maxBackups and list errors", async () => {
    const db = createErrorProneDb();

    // 1. PUT targetKey
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

    // 2. LIST returns an expired object and excess objects
    const oldTimestamp = Date.now() - 40 * 24 * 3600 * 1000;
    const recent1 = Date.now() - 2 * 3600 * 1000;
    const recent2 = Date.now() - 1 * 3600 * 1000;
    const listXml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Contents>
    <Key>backups/mail/full/2026-08-01_${oldTimestamp}_mail.json</Key>
    <LastModified>2026-08-01T00:00:00.000Z</LastModified>
  </Contents>
  <Contents>
    <Key>backups/mail/full/2026-09-17_${recent1}_mail.json</Key>
    <LastModified>2026-09-17T00:00:00.000Z</LastModified>
  </Contents>
  <Contents>
    <Key>backups/mail/full/2026-09-17_${recent2}_mail.json</Key>
    <LastModified>2026-09-17T01:00:00.000Z</LastModified>
  </Contents>
</ListBucketResult>`;
    mockFetch.mockResolvedValueOnce(new Response(listXml, { status: 200 }));
    // DELETE
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));

    const res = await performScheduledS3Backup({
      db,
      serviceName: "mail",
      retentionDays: 30,
      maxBackups: 1,
      s3: {
        endpoint: "https://r2.cloudflarestorage.com",
        bucket: "backups",
        accessKeyId: "ak",
        secretAccessKey: "sk",
      },
    });

    expect(res.success).toBe(true);
    expect(res.deletedKeys.length).toBeGreaterThanOrEqual(2);

    // Test retention list exception catch
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 })); // PUT
    mockFetch.mockRejectedValueOnce(new Error("Network timeout during LIST")); // LIST throws
    const res2 = await performScheduledS3Backup({
      db,
      serviceName: "mail",
      s3: {
        endpoint: "https://r2.cloudflarestorage.com",
        bucket: "backups",
        accessKeyId: "ak",
        secretAccessKey: "sk",
      },
    });
    expect(res2.success).toBe(true);
  });

  it("listIncrementalBackupsFromS3 ignores non-json and handles malformed timestamps with fallback", async () => {
    const listXml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Contents><Key>backups/mail/ignore_me.txt</Key></Contents>
  <Contents><Key>backups/mail/latest_watermark.json</Key></Contents>
  <Contents>
    <Key>backups/mail/inc/2026-09-17/fallback_mail.json</Key>
    <LastModified>2026-09-17T05:00:00.000Z</LastModified>
  </Contents>
</ListBucketResult>`;
    mockFetch.mockResolvedValueOnce(new Response(listXml, { status: 200 }));

    const res = await listIncrementalBackupsFromS3({
      serviceName: "mail",
      s3: {
        endpoint: "https://r2.cloudflarestorage.com",
        bucket: "backups",
        accessKeyId: "ak",
        secretAccessKey: "sk",
      },
    });

    expect(res.length).toBe(1);
    expect(res[0].key).toContain("fallback_mail.json");
    expect(res[0].untilTimestamp).toBe(new Date("2026-09-17T05:00:00.000Z").getTime());
  });
});
