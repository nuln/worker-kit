/**
 * D1 增量同步接收端的 LWW（Last-Write-Wins）时序保护测试。
 *
 * ## 为什么这组用例重要
 *
 * 同步是**乱序**常态：sender 对非 2xx 只 debug、无重试无补偿队列，事件可能在
 * 队列中滞留数小时。接收端因此必须自己做时序仲裁，否则：
 *
 * - **DELETE 无守卫**：节点 A 在 T1 删除记录、事件滞留；节点 B 在 T2 合法重建；
 *   事件送达后 B 上刚创建的记录被永久删除，且无法用任何时间戳挽回。
 * - **UPSERT 守卫可被绕过**：若 LWW 判定依据"载荷里有没有 `updated_at` 这个键"，
 *   那么只要省略该键（哪怕其余字段全是旧的），守卫整条消失，旧数据无条件
 *   覆盖本地较新记录 —— 等于让发送方决定接收端是否施加保护。
 *
 * 因此本组用例锁定两点：**DELETE 受时间戳约束**、**UPSERT 的 LWW 能力由本地
 * 表结构决定而非载荷形状**。
 */

import { describe, it, expect, vi } from "vitest";
import { handleD1SyncRequest } from "../../src/sync/receiver.js";

const SECRET = "sync_secret_for_lww_tests";

interface Executed {
  sql: string;
  bindings: unknown[];
}

/**
 * 构造支持 PRAGMA table_info 的 mock D1。
 *
 * @param columns 本地表实际拥有的列名（决定 LWW 守卫是否生效）
 */
function createDb(columns: string[]) {
  const executed: Executed[] = [];

  const db = {
    executed,
    prepare(sql: string) {
      if (/PRAGMA table_info/i.test(sql)) {
        return {
          all: vi.fn().mockImplementation(async () => ({
            success: true,
            results: columns.map((name) => ({ name })),
          })),
        };
      }
      return {
        bind: (...bindings: unknown[]) => ({
          run: vi.fn().mockImplementation(async () => {
            executed.push({ sql, bindings });
            return { success: true, meta: { changes: 1 } };
          }),
        }),
      };
    },
  };

  return db;
}

function postReq(body: unknown): Request {
  return new Request("http://localhost/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Sync-Secret": SECRET },
    body: JSON.stringify(body),
  });
}

const env = { BACKUP_SYNC_SECRET: SECRET };

/** 本地表具备 LWW 所需的列 */
const WITH_UPDATED_AT = ["id", "email", "updated_at"];
/** 本地表不具备该列（兼容老表） */
const WITHOUT_UPDATED_AT = ["id", "email"];

describe("DELETE 的 LWW 守卫", () => {
  it("本地表有 updated_at 时，删除必须附带时间戳条件", async () => {
    const db = createDb(WITH_UPDATED_AT);
    const res = await handleD1SyncRequest(
      postReq({
        table: "users",
        action: "DELETE",
        data: { id: "u42" },
        timestamp: 1_700_000_000_000,
      }),
      { ...env, DB: db } as any,
    );

    expect(res.status).toBe(200);
    const del = db.executed.find((e) => /^DELETE/i.test(e.sql.trim()));
    expect(del, "应执行一条 DELETE").toBeTruthy();
    // 关键：必须带 updated_at 守卫条件
    expect(del!.sql).toMatch(/updated_at/);
    expect(del!.sql).toMatch(/IS NULL OR/i);
    // 且必须绑定删除事件的时间戳
    expect(del!.bindings).toContain("u42");
    expect(del!.bindings).toContain(1_700_000_000_000);
  });

  it("载荷缺少 timestamp 时退回无条件删除（不丢事件）", async () => {
    const db = createDb(WITH_UPDATED_AT);
    const res = await handleD1SyncRequest(
      postReq({ table: "users", action: "DELETE", data: { id: "u42" } }),
      { ...env, DB: db } as any,
    );

    expect(res.status).toBe(200);
    const del = db.executed.find((e) => /^DELETE/i.test(e.sql.trim()));
    expect(del).toBeTruthy();
    // 无时间戳 → 走兼容分支，不含守卫
    expect(del!.sql).not.toMatch(/updated_at/);
  });

  it("本地表无 updated_at 列时退回无条件删除", async () => {
    const db = createDb(WITHOUT_UPDATED_AT);
    const res = await handleD1SyncRequest(
      postReq({
        table: "legacy",
        action: "DELETE",
        data: { id: "1" },
        timestamp: 1_700_000_000_000,
      }),
      { ...env, DB: db } as any,
    );

    expect(res.status).toBe(200);
    const del = db.executed.find((e) => /^DELETE/i.test(e.sql.trim()));
    expect(del).toBeTruthy();
    expect(del!.sql).not.toMatch(/updated_at/);
  });

  it("缺少主键时 400，且不执行任何 DELETE", async () => {
    const db = createDb(WITH_UPDATED_AT);
    const res = await handleD1SyncRequest(
      postReq({
        table: "users",
        action: "DELETE",
        data: { email: "x@y.z" },
        timestamp: 1,
      }),
      { ...env, DB: db } as any,
    );

    expect(res.status).toBe(400);
    expect(db.executed.filter((e) => /^DELETE/i.test(e.sql.trim()))).toHaveLength(0);
  });
});

describe("UPSERT 的 LWW 能力由本地表结构决定", () => {
  it("本地表有 updated_at：载荷也带 → 生成 LWW 守卫", async () => {
    const db = createDb(WITH_UPDATED_AT);
    const res = await handleD1SyncRequest(
      postReq({
        table: "users",
        action: "UPSERT",
        data: { id: "1", email: "a@b.c", updated_at: 1_700_000_000_000 },
      }),
      { ...env, DB: db } as any,
    );

    expect(res.status).toBe(200);
    const up = db.executed.find((e) => /^INSERT/i.test(e.sql.trim()));
    expect(up!.sql).toMatch(/excluded\."updated_at"/);
  });

  it("本地表有 updated_at 但载荷省略该键 → 400 拒绝（不静默放弃保护）", async () => {
    const db = createDb(WITH_UPDATED_AT);
    const res = await handleD1SyncRequest(
      postReq({
        table: "users",
        action: "UPSERT",
        // 刻意不含 updated_at：历史实现会因此完全跳过 LWW 守卫
        data: { id: "1", email: "stale@old" },
      }),
      { ...env, DB: db } as any,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/updated_at/);
    // 关键：不得执行任何写入
    expect(db.executed.filter((e) => /^INSERT/i.test(e.sql.trim()))).toHaveLength(0);
  });

  it("本地表无 updated_at：不加守卫，兼容老表正常同步", async () => {
    const db = createDb(WITHOUT_UPDATED_AT);
    const res = await handleD1SyncRequest(
      postReq({
        table: "legacy",
        action: "UPSERT",
        data: { id: "1", email: "a@b.c" },
      }),
      { ...env, DB: db } as any,
    );

    expect(res.status).toBe(200);
    const up = db.executed.find((e) => /^INSERT/i.test(e.sql.trim()));
    expect(up).toBeTruthy();
    expect(up!.sql).not.toMatch(/excluded\."updated_at"/);
  });
});
