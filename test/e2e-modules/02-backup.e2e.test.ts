import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  exportD1Incremental,
  performScheduledIncrementalBackup,
  restoreIncrementalChainFromS3,
} from "../../src/backup/index.js";

describe("[E2E Example] 02 - D1 Database Automated Incremental Backup & One-Click Chain Restore", () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("performs incremental backup and one-click chain recovery with dry-run verification", async () => {
    // 1. Primary D1 Database with dynamic and static tables
    const primaryDbData: Record<string, any[]> = {
      users: [
        { id: "usr_1", email: "admin@nuln.net", role: "super_admin", updated_at: 1000 },
        { id: "usr_2", email: "member@nuln.net", role: "member", updated_at: 2000 },
      ],
      messages: [
        { id: "msg_1", subject: "Welcome to Nuln", created_at: 1500 },
      ],
      settings: [{ key: "site_name", value: "Nuln Workspace" }],
    };

    const primaryDb = {
      prepare(sql: string) {
        return {
          bind(...params: any[]) {
            return {
              async all() {
                const match = sql.match(/FROM\s+"?([^"\s]+)"?/i);
                const tbl = match ? match[1] : "";
                const rows = primaryDbData[tbl] || [];
                if (sql.includes("WHERE")) {
                  const threshold = params[0];
                  return {
                    results: rows.filter((r) => (r.updated_at || r.created_at || 0) > threshold),
                  };
                }
                return { results: rows };
              },
            };
          },
          async all() {
            if (sql.includes("sqlite_master")) {
              return { results: Object.keys(primaryDbData).map((name) => ({ name })) };
            }
            if (sql.includes("PRAGMA table_info")) {
              const match = sql.match(/PRAGMA table_info\("?([^"\s]+)"?\)/i);
              const tbl = match ? match[1] : "";
              const firstRow = primaryDbData[tbl]?.[0] || {};
              return { results: Object.keys(firstRow).map((c) => ({ name: c })) };
            }
            const match = sql.match(/FROM\s+"?([^"\s]+)"?/i);
            const tbl = match ? match[1] : "";
            return { results: primaryDbData[tbl] || [] };
          },
        };
      },
    };

    // 2. Perform automated scheduled incremental S3 backup
    // 2.1 GET watermark (not found/first run)
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    // 2.2 PUT target incremental json
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"etag-ok"' } }));
    // 2.3 PUT latest_watermark.json
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
    // 2.4 LIST objects for retention
    mockFetch.mockResolvedValueOnce(new Response("<ListBucketResult><Contents></Contents></ListBucketResult>", { status: 200 }));

    const backupResult = await performScheduledIncrementalBackup({
      db: primaryDb as any,
      serviceName: "mail",
      retentionDays: 30,
      maxBackups: 50,
      staticTables: ["settings"],
      s3: {
        endpoint: "https://r2.cloudflarestorage.com",
        bucket: "backups",
        accessKeyId: "key",
        secretAccessKey: "secret",
      },
    });

    expect(backupResult.success).toBe(true);
    expect(backupResult.skipped).toBe(false);
    expect(backupResult.uploadedKey).toContain("backups/mail/inc/");
    expect(backupResult.totalChangedRows).toBe(3);

    // 3. Export bundle directly for verification
    const bundle = await exportD1Incremental(primaryDb as any, {
      serviceName: "mail",
      sinceTimestamp: 0,
      staticTables: ["settings"],
    });
    expect(bundle.checksum.startsWith("sha256:")).toBe(true);
    expect(bundle.tables.users.rowCount).toBe(2);
    expect(bundle.tables.messages.rowCount).toBe(1);
    expect(bundle.tables.settings.rowCount).toBe(1);

    // 4. Standby / Disaster Recovery Database
    const drDbData: Record<string, any[]> = { users: [], messages: [], settings: [] };
    const drDb = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) {
            return {
              async run() {
                if (sql.startsWith("INSERT")) {
                  const match = sql.match(/INTO\s+"?([^"(\s]+)"?\s*\(([^)]+)\)/i);
                  if (match) {
                    const tbl = match[1];
                    const cols = match[2].split(",").map((c) => c.trim().replace(/"/g, ""));
                    const row: any = {};
                    cols.forEach((col, idx) => (row[col] = args[idx]));
                    if (!drDbData[tbl]) drDbData[tbl] = [];
                    drDbData[tbl].push(row);
                  }
                }
                return { success: true };
              },
            };
          },
          async run() {
            return { success: true };
          },
        };
      },
      async batch(stmts: any[]) {
        for (const s of stmts) await s.run();
        return [];
      },
    };

    // 5. Restore incremental chain from S3
    const listXml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Contents><Key>backups/mail/inc/2026-09-17/1000_since_0_mail.json</Key></Contents>
</ListBucketResult>`;
    mockFetch.mockResolvedValueOnce(new Response(listXml, { status: 200 })); // LIST
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(bundle), { status: 200 })); // GET

    const restoreResult = await restoreIncrementalChainFromS3({
      db: drDb as any,
      serviceName: "mail",
      dryRun: false,
      s3: {
        endpoint: "https://r2.cloudflarestorage.com",
        bucket: "backups",
        accessKeyId: "key",
        secretAccessKey: "secret",
      },
    });

    expect(restoreResult.success).toBe(true);
    expect(restoreResult.appliedBundlesCount).toBe(1);
    expect(restoreResult.totalRowsAffected).toBe(4);
    expect(drDbData.users.length).toBe(2);
    expect(drDbData.messages.length).toBe(1);
    expect(drDbData.users[0].email).toBe("admin@nuln.net");
  });
});

