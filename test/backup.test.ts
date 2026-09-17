import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exportD1Database, exportD1Incremental, restoreD1Database } from "../src/backup/engine.js";
import {
  performScheduledS3Backup,
  performScheduledIncrementalBackup,
  listIncrementalBackupsFromS3,
  restoreIncrementalChainFromS3,
} from "../src/backup/s3-backup.js";
import type { BackupBundle, IncrementalBackupBundle } from "../src/backup/types.js";

function createMockD1Database(data: Record<string, any[]> = {}) {
  const tableData: Record<string, any[]> = { ...data };

  return {
    _data: tableData,
    prepare(sql: string) {
      return {
        bind(...params: any[]) {
          return {
            async run() {
              if (sql.startsWith("INSERT OR REPLACE INTO") || sql.startsWith("INSERT INTO") || sql.startsWith("INSERT OR IGNORE INTO")) {
                const match = sql.match(/INSERT(?:\s+OR\s+\w+)?\s+INTO\s+"?([^"(\s]+)"?\s*\(([^)]+)\)/i);
                if (match) {
                  const table = match[1];
                  const cols = match[2].split(",").map((c) => c.trim().replace(/"/g, ""));
                  const row: Record<string, any> = {};
                  cols.forEach((col, idx) => {
                    row[col] = params[idx];
                  });
                  if (!tableData[table]) tableData[table] = [];
                  const pk = cols[0]; // e.g. 'name' or 'id'
                  const existingIdx = tableData[table].findIndex((r) => r[pk] === row[pk]);
                  if (existingIdx >= 0 && (sql.includes("REPLACE") || sql.includes("INSERT INTO"))) {
                    tableData[table][existingIdx] = row;
                  } else if (existingIdx < 0) {
                    tableData[table].push(row);
                  }
                }
              }
              return { success: true };
            },
            async all() {
              // Handle queries like WHERE updated_at > ? OR created_at > ?
              const tableMatch = sql.match(/FROM\s+"?([^"\s]+)"?/i);
              if (tableMatch) {
                const table = tableMatch[1];
                const rows = tableData[table] || [];
                if (sql.includes("LIMIT") && sql.includes("OFFSET")) {
                  const limit = params[0] || 1000;
                  const offset = params[1] || 0;
                  return { results: rows.slice(offset, offset + limit) };
                }
                if (sql.includes("WHERE")) {
                  const threshold = params[0];
                  return {
                    results: rows.filter((r) => {
                      const ts = r.updated_at || r.created_at || 0;
                      return ts > threshold;
                    }),
                  };
                }
                return { results: rows };
              }
              return { results: [] };
            },
          };
        },
        async all() {
          if (sql.includes("sqlite_master")) {
            return {
              results: Object.keys(tableData).map((name) => ({ name })),
            };
          }
          if (sql.includes("PRAGMA table_info")) {
            const tableMatch = sql.match(/PRAGMA table_info\("?([^"\s]+)"?\)/i);
            if (tableMatch && tableData[tableMatch[1]]) {
              const firstRow = tableData[tableMatch[1]][0] || {};
              return {
                results: Object.keys(firstRow).map((col) => ({ name: col })),
              };
            }
            return { results: [] };
          }
          const tableMatch = sql.match(/FROM\s+"?([^"\s]+)"?/i);
          if (tableMatch) {
            const table = tableMatch[1];
            return { results: tableData[table] || [] };
          }
          return { results: [] };
        },
        async run() {
          if (sql.startsWith("DELETE FROM")) {
            const match = sql.match(/DELETE FROM\s+"?([^"\s]+)"?/i);
            if (match) {
              const table = match[1];
              tableData[table] = [];
            }
          }
          return { success: true };
        },
      };
    },
    async batch(statements: any[]) {
      for (const stmt of statements) {
        await stmt.run();
      }
      return [];
    },
  };
}

describe("@nuln/worker-kit/backup - Database Export & Restore Engine", () => {
  it("exportD1Database dumps all non-system tables with deterministic checksum", async () => {
    const mockDb = createMockD1Database({
      users: [
        { id: "u1", email: "alice@test.com", created_at: 1000 },
        { id: "u2", email: "bob@test.com", created_at: 2000 },
      ],
      settings: [{ key: "site_name", value: "Nuln" }],
      sqlite_sequence: [{ name: "users", seq: 2 }],
      _cf_KV: [{ key: "internal" }],
    });

    const bundle = await exportD1Database(mockDb, {
      serviceName: "tower",
      metadata: { environment: "test" },
    });

    expect(bundle.version).toBe(1);
    expect(bundle.service).toBe("tower");
    expect(bundle.mode).toBe("full");
    expect(bundle.checksum.startsWith("sha256:")).toBe(true);
    expect(bundle.tables["users"]).toBeDefined();
    expect(bundle.tables["users"].rowCount).toBe(2);
    expect(bundle.tables["settings"]).toBeDefined();
    // System tables excluded
    expect(bundle.tables["sqlite_sequence"]).toBeUndefined();
    expect(bundle.tables["_cf_KV"]).toBeUndefined();
  });

  it("exportD1Database respects includeTables and excludeTables options", async () => {
    const mockDb = createMockD1Database({
      table_a: [{ id: 1 }],
      table_b: [{ id: 2 }],
      table_c: [{ id: 3 }],
    });

    const incBundle = await exportD1Database(mockDb, {
      includeTables: ["table_a", "table_b"],
    });
    expect(Object.keys(incBundle.tables)).toEqual(["table_a", "table_b"]);

    const excBundle = await exportD1Database(mockDb, {
      excludeTables: ["table_b"],
    });
    expect(Object.keys(excBundle.tables).sort()).toEqual(["table_a", "table_c"].sort());
  });

  it("exportD1Incremental extracts only changed rows and static tables", async () => {
    const mockDb = createMockD1Database({
      users: [
        { id: "u1", name: "Alice", updated_at: 1000 },
        { id: "u2", name: "Bob", updated_at: 5000 },
        { id: "u3", name: "Charlie", updated_at: 8000 },
      ],
      messages: [
        { id: "m1", text: "hi", created_at: 2000 },
        { id: "m2", text: "latest", created_at: 6000 },
      ],
      settings: [{ key: "app_theme", value: "dark" }],
    });

    // 1. Initial base (sinceTimestamp = 0)
    const baseBundle = await exportD1Incremental(mockDb, {
      serviceName: "mail",
      sinceTimestamp: 0,
      untilTimestamp: 10000,
    });
    expect(baseBundle.mode).toBe("incremental");
    expect(baseBundle.sinceTimestamp).toBe(0);
    expect(baseBundle.tables["users"].rowCount).toBe(3);
    expect(baseBundle.tables["messages"].rowCount).toBe(2);
    expect(baseBundle.staticConfig?.["settings"]).toBeDefined();

    // 2. Incremental extract (sinceTimestamp = 4000)
    const incBundle = await exportD1Incremental(mockDb, {
      serviceName: "mail",
      sinceTimestamp: 4000,
      untilTimestamp: 10000,
      staticTables: ["settings"],
    });
    expect(incBundle.tables["users"].rowCount).toBe(2); // u2 (5000) and u3 (8000)
    expect(incBundle.tables["messages"].rowCount).toBe(1); // m2 (6000)
    expect(incBundle.tables["settings"].rowCount).toBe(1); // static table fully attached
    expect(incBundle.totalChangedRows).toBe(3);
  });

  it("restoreD1Database restores tables successfully", async () => {
    const initialDb = createMockD1Database({
      users: [{ id: "u1", email: "old@test.com" }],
    });

    const bundleToRestore: BackupBundle = {
      version: 1,
      service: "tower",
      timestamp: Date.now(),
      createdAt: new Date().toISOString(),
      checksum: "", // will calculate below
      tables: {
        users: {
          name: "users",
          rowCount: 2,
          columns: ["id", "email"],
          rows: [
            { id: "u1", email: "alice@test.com" },
            { id: "u2", email: "bob@test.com" },
          ],
        },
      },
    };

    // Calculate valid checksum
    const dataPayload = JSON.stringify(bundleToRestore.tables);
    const { sha256Hex } = await import("../src/s3/sigv4.js");
    bundleToRestore.checksum = `sha256:${await sha256Hex(dataPayload)}`;

    const summary = await restoreD1Database(initialDb, bundleToRestore, {
      truncateBeforeInsert: true,
      conflictStrategy: "replace",
    });

    expect(summary.success).toBe(true);
    expect(summary.restoredTables).toContain("users");
    expect(summary.totalRowsInserted).toBe(2);
    expect(initialDb._data["users"].length).toBe(2);
  });

  it("restoreD1Database rejects corrupted checksum", async () => {
    const db = createMockD1Database();
    const badBundle: BackupBundle = {
      version: 1,
      service: "tower",
      timestamp: Date.now(),
      createdAt: new Date().toISOString(),
      checksum: "sha256:invalid_checksum_value",
      tables: {
        users: {
          name: "users",
          rowCount: 1,
          columns: ["id"],
          rows: [{ id: 1 }],
        },
      },
    };

    const summary = await restoreD1Database(db, badBundle, { verifyChecksum: true });
    expect(summary.success).toBe(false);
    expect(summary.error).toContain("Checksum mismatch");
  });

  it("restoreD1Database handles empty tables or invalid version safely", async () => {
    const db = createMockD1Database();
    const invalidVersion = await restoreD1Database(db, { version: 99 } as any);
    expect(invalidVersion.success).toBe(false);

    const emptyBundle: BackupBundle = {
      version: 1,
      service: "tower",
      timestamp: Date.now(),
      createdAt: new Date().toISOString(),
      checksum: "sha256:" + (await (await import("../src/s3/sigv4.js")).sha256Hex(JSON.stringify({ empty: { name: "empty", rowCount: 0, columns: [], rows: [] } }))),
      tables: {
        empty: { name: "empty", rowCount: 0, columns: [], rows: [] },
      },
    };

    const res = await restoreD1Database(db, emptyBundle);
    expect(res.success).toBe(true);
    expect(res.restoredTables).toContain("empty");
    expect(res.totalRowsInserted).toBe(0);
  });
});

describe("@nuln/worker-kit/backup - Incremental S3 Backup, Watermark Tracking & Chain Restore", () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("performScheduledIncrementalBackup uploads incremental bundle and updates watermark", async () => {
    const mockDb = createMockD1Database({
      messages: [{ id: "m1", body: "hello", updated_at: 5000 }],
    });

    // 1. GET watermark (404/not found initially)
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    // 2. PUT targetKey
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"etag-1"' } }));
    // 3. PUT latest_watermark.json
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
    // 4. LIST objects for retention
    mockFetch.mockResolvedValueOnce(new Response("<ListBucketResult><Contents></Contents></ListBucketResult>", { status: 200 }));

    const res = await performScheduledIncrementalBackup({
      db: mockDb,
      serviceName: "mail",
      s3: {
        endpoint: "https://r2.cloudflarestorage.com",
        bucket: "backups",
        accessKeyId: "ak",
        secretAccessKey: "sk",
      },
    });

    expect(res.success).toBe(true);
    expect(res.skipped).toBe(false);
    expect(res.uploadedKey).toContain("backups/mail/inc/");
    expect(res.totalChangedRows).toBe(1);
    expect(res.checksum?.startsWith("sha256:")).toBe(true);
  });

  it("performScheduledIncrementalBackup skips upload on 0 changes when skipZeroChanges=true", async () => {
    const mockDb = createMockD1Database({
      messages: [{ id: "m1", body: "hello", updated_at: 1000 }],
    });

    // 1. GET watermark returns watermark = 2000 (after updated_at)
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ lastWatermark: 2000, service: "mail" }), { status: 200 })
    );

    const res = await performScheduledIncrementalBackup({
      db: mockDb,
      serviceName: "mail",
      skipZeroChanges: true,
      s3: {
        endpoint: "https://r2.cloudflarestorage.com",
        bucket: "backups",
        accessKeyId: "ak",
        secretAccessKey: "sk",
      },
    });

    expect(res.success).toBe(true);
    expect(res.skipped).toBe(true);
    expect(res.totalChangedRows).toBe(0);
    // Only 1 GET request made to check watermark, no PUTs made
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("listIncrementalBackupsFromS3 parses and sorts incremental backups chronologically", async () => {
    const listXml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Contents>
    <Key>backups/tower/inc/2026-09-17/1789540000000_since_1789530000000_tower.json</Key>
    <LastModified>2026-09-17T02:00:00.000Z</LastModified>
    <Size>512</Size>
  </Contents>
  <Contents>
    <Key>backups/tower/inc/2026-09-16/1789450000000_since_0_tower.json</Key>
    <LastModified>2026-09-16T02:00:00.000Z</LastModified>
    <Size>1024</Size>
  </Contents>
</ListBucketResult>`;
    mockFetch.mockResolvedValueOnce(new Response(listXml, { status: 200 }));

    const summaries = await listIncrementalBackupsFromS3({
      serviceName: "tower",
      s3: {
        endpoint: "https://r2.cloudflarestorage.com",
        bucket: "backups",
        accessKeyId: "ak",
        secretAccessKey: "sk",
      },
    });

    expect(summaries.length).toBe(2);
    // Sorted ascending: 1789450000000 before 1789540000000
    expect(summaries[0].sinceTimestamp).toBe(0);
    expect(summaries[1].sinceTimestamp).toBe(1789530000000);
  });

  it("restoreIncrementalChainFromS3 replays incremental bundles with dry-run support", async () => {
    const mockDb = createMockD1Database({
      subs: [{ name: "sub1", url: "https://old.url" }],
    });

    const { sha256Hex } = await import("../src/s3/sigv4.js");

    // Bundle 1 (base): sub1, sub2
    const bundle1Tables = {
      subs: {
        name: "subs",
        rowCount: 2,
        columns: ["name", "url"],
        rows: [
          { name: "sub1", url: "https://updated1.url" },
          { name: "sub2", url: "https://sub2.url" },
        ],
      },
    };
    const bundle1: IncrementalBackupBundle = {
      version: 1,
      mode: "incremental",
      service: "tower",
      sinceTimestamp: 0,
      untilTimestamp: 1000,
      timestamp: 1000,
      createdAt: new Date(1000).toISOString(),
      totalChangedRows: 2,
      checksum: `sha256:${await sha256Hex(JSON.stringify(bundle1Tables))}`,
      tables: bundle1Tables,
    };

    // Bundle 2 (delta): sub3 added
    const bundle2Tables = {
      subs: {
        name: "subs",
        rowCount: 1,
        columns: ["name", "url"],
        rows: [{ name: "sub3", url: "https://sub3.url" }],
      },
    };
    const bundle2: IncrementalBackupBundle = {
      version: 1,
      mode: "incremental",
      service: "tower",
      sinceTimestamp: 1000,
      untilTimestamp: 2000,
      timestamp: 2000,
      createdAt: new Date(2000).toISOString(),
      totalChangedRows: 1,
      checksum: `sha256:${await sha256Hex(JSON.stringify(bundle2Tables))}`,
      tables: bundle2Tables,
    };

    // 1. Dry Run Execution
    const listXml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Contents><Key>backups/tower/inc/2026-09-16/1000_since_0_tower.json</Key></Contents>
  <Contents><Key>backups/tower/inc/2026-09-17/2000_since_1000_tower.json</Key></Contents>
</ListBucketResult>`;
    mockFetch.mockResolvedValueOnce(new Response(listXml, { status: 200 })); // LIST
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(bundle1), { status: 200 })); // GET 1
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(bundle2), { status: 200 })); // GET 2

    const dryRunResult = await restoreIncrementalChainFromS3({
      db: mockDb,
      serviceName: "tower",
      dryRun: true,
      s3: {
        endpoint: "https://r2.cloudflarestorage.com",
        bucket: "backups",
        accessKeyId: "ak",
        secretAccessKey: "sk",
      },
    });

    expect(dryRunResult.success).toBe(true);
    expect(dryRunResult.dryRun).toBe(true);
    expect(dryRunResult.appliedBundlesCount).toBe(2);
    expect(dryRunResult.totalRowsAffected).toBe(3);
    // DB unchanged in dry run
    expect(mockDb._data["subs"].length).toBe(1);

    // 2. Real Restore Execution
    mockFetch.mockResolvedValueOnce(new Response(listXml, { status: 200 })); // LIST
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(bundle1), { status: 200 })); // GET 1
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(bundle2), { status: 200 })); // GET 2

    const realResult = await restoreIncrementalChainFromS3({
      db: mockDb,
      serviceName: "tower",
      dryRun: false,
      conflictStrategy: "replace",
      s3: {
        endpoint: "https://r2.cloudflarestorage.com",
        bucket: "backups",
        accessKeyId: "ak",
        secretAccessKey: "sk",
      },
    });

    expect(realResult.success).toBe(true);
    expect(realResult.dryRun).toBe(false);
    expect(realResult.appliedBundlesCount).toBe(2);
    expect(mockDb._data["subs"].length).toBe(3); // All 3 records restored/updated
  });
});

