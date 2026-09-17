import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exportD1Database, restoreD1Database, performScheduledS3Backup } from "../../src/backup/index.js";

describe("[E2E Example] 02 - D1 Database Automated Backup & Disaster Recovery", () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("exports D1 database, uploads to S3 with retention, and restores to secondary DB", async () => {
    // 1. Primary D1 Database with application data
    const primaryDbData: Record<string, any[]> = {
      users: [
        { id: "usr_1", email: "admin@nuln.net", role: "super_admin" },
        { id: "usr_2", email: "member@nuln.net", role: "member" },
      ],
      sessions: [{ id: "sess_100", user_id: "usr_1" }],
    };

    const primaryDb = {
      prepare(sql: string) {
        return {
          async all() {
            if (sql.includes("sqlite_master")) {
              return { results: Object.keys(primaryDbData).map((name) => ({ name })) };
            }
            const match = sql.match(/FROM\s+"?([^"\s]+)"?/i);
            const tbl = match ? match[1] : "";
            return { results: primaryDbData[tbl] || [] };
          },
        };
      },
    };

    // 2. Perform automated scheduled S3 backup
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"etag-ok"' } })); // PUT
    mockFetch.mockResolvedValueOnce(new Response("<ListBucketResult><Contents></Contents></ListBucketResult>", { status: 200 })); // LIST

    const backupResult = await performScheduledS3Backup({
      db: primaryDb as any,
      serviceName: "tower",
      retentionDays: 30,
      maxBackups: 50,
      s3: {
        endpoint: "https://r2.cloudflarestorage.com",
        bucket: "backups",
        accessKeyId: "key",
        secretAccessKey: "secret",
      },
    });

    expect(backupResult.success).toBe(true);
    expect(backupResult.uploadedKey).toContain("backups/tower/");

    // 3. Export bundle directly for verification
    const bundle = await exportD1Database(primaryDb as any, { serviceName: "tower" });
    expect(bundle.checksum.startsWith("sha256:")).toBe(true);
    expect(bundle.tables.users.rowCount).toBe(2);

    // 4. Standby / Disaster Recovery Database
    const drDbData: Record<string, any[]> = { users: [], sessions: [] };
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

    // 5. Restore bundle into DR Database
    const restoreResult = await restoreD1Database(drDb as any, bundle, {
      truncateBeforeInsert: true,
      conflictStrategy: "replace",
      verifyChecksum: true,
    });

    expect(restoreResult.success).toBe(true);
    expect(restoreResult.restoredTables).toContain("users");
    expect(restoreResult.totalRowsInserted).toBe(3);
    expect(drDbData.users.length).toBe(2);
    expect(drDbData.users[0].email).toBe("admin@nuln.net");
  });
});
