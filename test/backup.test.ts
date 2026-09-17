import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exportD1Database, restoreD1Database } from "../src/backup/engine.js";
import { performScheduledS3Backup } from "../src/backup/s3-backup.js";
import type { BackupBundle } from "../src/backup/types.js";

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
                  tableData[table].push(row);
                }
              }
              return { success: true };
            },
            async all() {
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

describe("@nuln/worker-kit/backup - Scheduled S3 Backup & Retention", () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("performScheduledS3Backup performs export, upload, and retention cleanup", async () => {
    const mockDb = createMockD1Database({
      messages: [{ id: "m1", body: "hello" }],
    });

    // 1. PUT response
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"etag-1"' } }));

    // 2. LIST response with old expired backup and fresh backup
    const listXml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Contents>
    <Key>backups/mail/2026-08-01_1722470400000_mail.json</Key>
    <LastModified>2026-08-01T00:00:00.000Z</LastModified>
    <Size>100</Size>
  </Contents>
  <Contents>
    <Key>backups/mail/2026-09-16_1789400000000_mail.json</Key>
    <LastModified>2026-09-16T00:00:00.000Z</LastModified>
    <Size>200</Size>
  </Contents>
</ListBucketResult>`;
    mockFetch.mockResolvedValueOnce(new Response(listXml, { status: 200 }));

    // 3. DELETE response for the expired backup
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await performScheduledS3Backup({
      db: mockDb,
      serviceName: "mail",
      retentionDays: 14,
      maxBackups: 10,
      s3: {
        endpoint: "https://r2.cloudflarestorage.com",
        bucket: "backups",
        accessKeyId: "ak",
        secretAccessKey: "sk",
      },
    });

    expect(result.success).toBe(true);
    expect(result.uploadedKey).toContain("backups/mail/");
    expect(result.checksum.startsWith("sha256:")).toBe(true);
    expect(result.deletedKeys).toContain("backups/mail/2026-08-01_1722470400000_mail.json");
    expect(mockFetch).toHaveBeenCalledTimes(3); // PUT + LIST + DELETE
  });

  it("performScheduledS3Backup enforces maxBackups policy", async () => {
    const mockDb = createMockD1Database({ items: [{ id: 1 }] });

    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

    // Return 3 items while maxBackups = 2
    const listXml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Contents><Key>backups/push/2026-09-10_1788800000000_push.json</Key></Contents>
  <Contents><Key>backups/push/2026-09-11_1788900000000_push.json</Key></Contents>
  <Contents><Key>backups/push/2026-09-12_1789000000000_push.json</Key></Contents>
</ListBucketResult>`;
    mockFetch.mockResolvedValueOnce(new Response(listXml, { status: 200 }));
    // Delete oldest excess items
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));

    const res = await performScheduledS3Backup({
      db: mockDb,
      serviceName: "push",
      retentionDays: 365,
      maxBackups: 2,
      s3: {
        endpoint: "http://127.0.0.1:9000",
        bucket: "backups",
        accessKeyId: "ak",
        secretAccessKey: "sk",
      },
    });

    expect(res.success).toBe(true);
    expect(res.deletedKeys.length).toBeGreaterThanOrEqual(2);
  });
});
