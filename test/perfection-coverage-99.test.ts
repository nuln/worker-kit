import { describe, it, expect, vi } from "vitest";
import {
  isAdminRole,
  isUserInAdminList,
  computeEffectiveUserGroups,
} from "../src/rbac/index.js";
import {
  renderAuthContainer,
  renderConfirmCard,
} from "../src/ui/auth.js";
import {
  exportD1Database,
  restoreD1Database,
} from "../src/backup/engine.js";
import {
  performScheduledS3Backup,
} from "../src/backup/s3-backup.js";
import {
  verifyDnsViaDoH,
} from "../src/dns/index.js";
import {
  verifyPassword,
} from "../src/crypto/index.js";
import {
  PasskeyService,
} from "../src/auth/passkey.js";
import { sha256Hex } from "../src/s3/sigv4.js";

describe("Perfection 99% Coverage Boost Suite", () => {
  it("covers RBAC edge cases: null roles, admin lists, and effective groups", () => {
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
    expect(isAdminRole("")).toBe(false);
    expect(isAdminRole("administrator")).toBe(true);
    expect(isAdminRole("超级管理员")).toBe(true);

    expect(isUserInAdminList(null, [])).toBe(false);
    expect(isUserInAdminList("", ["admin@nuln.net"])).toBe(false);
    expect(isUserInAdminList("admin@nuln.net", ["ADMIN@NULN.NET"])).toBe(true);
    expect(isUserInAdminList("other@nuln.net", ["admin@nuln.net"])).toBe(false);

    const groups = computeEffectiveUserGroups(["dev", "  ", ""], ["ops", "  "], true);
    expect(groups).toContain("dev");
    expect(groups).toContain("ops");
    expect(groups).toContain("admin");
    expect(groups).not.toContain("");
  });

  it("covers UI Auth container and confirm card variations", () => {
    const cardHtml = renderConfirmCard({
      title: "Confirm Sign In",
      brandName: "Tower",
      actionUrl: "/login/confirm",
      csrfToken: "csrf_token_123",
      extraInputsHtml: "<input type='hidden' name='redirect' value='/dashboard'>",
      buttonText: "Approve Sign In",
      message: "Please click below to confirm login.",
      warningText: "This link will expire in 5 minutes.",
      lang: "en",
    });
    expect(cardHtml).toContain("Confirm Sign In");
    expect(cardHtml).toContain("csrf_token_123");
    expect(cardHtml).toContain("This link will expire in 5 minutes.");

    const containerWithSub = renderAuthContainer({
      title: "Title",
      subTitle: "Sub description",
      bodyHtml: "<p>Body</p>",
      lang: "zh",
    });
    expect(containerWithSub).toContain("Sub description");
  });

  it("covers Backup engine error handling during dump and restore", async () => {
    // Failing table dump
    const failingDb = {
      prepare(sql: string) {
        if (sql.includes("SELECT name FROM sqlite_master")) {
          return {
            async all() {
              return { results: [{ name: "broken_table" }] };
            },
          };
        }
        throw new Error("Table query failed");
      },
    };

    const dumpResult = await exportD1Database(failingDb as any, { serviceName: "Tower" });
    expect(dumpResult.service).toBe("Tower");

    // Failing restore with valid checksum
    const tables = {
      users: { name: "users", rowCount: 1, columns: ["id"], rows: [{ id: "1" }] },
    };
    const validChecksum = `sha256:${await sha256Hex(JSON.stringify(tables))}`;

    const failingRestoreDb = {
      prepare() {
        throw new Error("Disk quota exceeded");
      },
    };

    const restoreRes = await restoreD1Database(failingRestoreDb as any, {
      version: 1,
      service: "Tower",
      timestamp: Date.now(),
      createdAt: new Date().toISOString(),
      checksum: validChecksum,
      tables,
    });

    expect(restoreRes.success).toBe(false);
    expect(restoreRes.error).toContain("Disk quota exceeded");
  });

  it("covers S3 Backup retention cleanup fallback date and error branch", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as any;

    try {
      const mockDb: any = {
        prepare(sql: string) {
          return {
            async all() { return { results: [] }; },
          };
        },
      };

      const res = await performScheduledS3Backup({
        db: mockDb,
        serviceName: "Mail",
        s3: {
          provider: "r2",
          endpoint: "https://r2.cloudflarestorage.com",
          accessKeyId: "key",
          secretAccessKey: "secret",
          bucket: "backups",
        },
        retentionDays: 1,
        maxBackups: 1,
      });
      expect(res.success).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("covers DNS check non-matching records and query error fallback", async () => {
    const res = await verifyDnsViaDoH("localhost", [
      { type: "CNAME", name: "mail", content: "mail.nuln.net" },
    ], true);
    expect(res.configured).toBe(true);
  });

  it("covers verifyPassword malformed hash formats", async () => {
    expect(await verifyPassword("password", "invalid_format")).toBe(false);
    expect(await verifyPassword("password", "sha1:hash:123")).toBe(false);
  });

  it("covers PasskeyService challenge user mismatch and key formats", async () => {
    const mockDb: any = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) {
            return {
              async first() {
                if (sql.includes("passkey_challenges")) {
                  return {
                    challenge: "chal_123",
                    user_id: "user_A",
                    expires_at: new Date(Date.now() + 60000).toISOString(),
                  };
                }
                return null;
              },
              async run() { return { meta: {} }; },
            };
          },
        };
      },
    };

    const service = new PasskeyService({
      rpName: "Test",
      rpID: "localhost",
      origin: "http://localhost:8787",
    });

    await expect(
      service.verifyRegisterResponse(mockDb, "user_B", "tmp_1", { id: "1" } as any)
    ).rejects.toThrow("passkey_user_mismatch");
  });
});
