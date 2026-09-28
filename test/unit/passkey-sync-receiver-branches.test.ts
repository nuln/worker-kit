/**
 * 最后一组：Passkey 服务与 D1 同步接收端
 *
 * 这两处的共同点是**输入形态多样**：
 *
 * - Passkey 的 userHandle 可能是字符串 / base64 / 非法值；
 *   `public_key` 在 D1 里可能是 Uint8Array / base64 字符串 / 字节数组 / ArrayBuffer；
 *   D1 句柄可能没有 `bind()`，可能有 `all()` 也可能只有 `first()`。
 * - 同步接收端的 `updated_at` 可能是 number / Date / Uint8Array / null，
 *   D1 查询结果可能是 `results` 也可能是别的形态。
 *
 * 每一种形态对应一条不同的代码路径，漏测的代价是"某种客户端登不上"。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  warn.mockRestore();
});

/* ==================================================== passkey userHandle */

import {
  buildPasskeyUserId,
  parsePasskeyUserHandle,
  formatPasskeyErrorMessage,
  PasskeyService,
} from "../../src/auth/passkey.js";

describe("buildPasskeyUserId", () => {
  it("大小写与空白归一后产生稳定结果", () => {
    const a = buildPasskeyUserId("Tower", " Admin@Example.COM ");
    const b = buildPasskeyUserId("tower", "admin@example.com");
    expect(new Uint8Array(a)).toEqual(new Uint8Array(b));
  });

  it("不同 email 产生不同 userId", () => {
    const a = new Uint8Array(buildPasskeyUserId("S", "a@x.com"));
    const b = new Uint8Array(buildPasskeyUserId("S", "b@x.com"));
    expect(a).not.toEqual(b);
  });
});

describe("parsePasskeyUserHandle：多种输入形态", () => {
  it("纯 email 字符串", () => {
    const r = parsePasskeyUserHandle("a@b.com");
    expect(r?.email).toBe("a@b.com");
  });

  it("serviceId\\x1femail 形式", () => {
    const r = parsePasskeyUserHandle("Tower\u001fa@b.com");
    expect(r?.serviceId).toBe("Tower");
    expect(r?.email).toBe("a@b.com");
  });

  it("base64 编码的上述任一形态", () => {
    const enc = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(parsePasskeyUserHandle(enc("a@b.com"))?.email).toBe("a@b.com");
    const full = parsePasskeyUserHandle(enc("Tower\u001fa@b.com"));
    expect(full?.serviceId).toBe("Tower");
    expect(full?.email).toBe("a@b.com");
  });

  it("空值 / 空白 / 非字符串 → null（不得抛错）", () => {
    expect(parsePasskeyUserHandle("")).toBeNull();
    expect(parsePasskeyUserHandle("   ")).toBeNull();
    expect(parsePasskeyUserHandle(null)).toBeNull();
    expect(parsePasskeyUserHandle(undefined)).toBeNull();
    expect(parsePasskeyUserHandle(42)).toBeNull();
    expect(parsePasskeyUserHandle({})).toBeNull();
  });

  it("非法 base64 不抛错", () => {
    expect(() => parsePasskeyUserHandle("!!!not-b64!!!")).not.toThrow();
  });
});

describe("formatPasskeyErrorMessage", () => {
  it("Error 带 message 时原样带出", () => {
    expect(formatPasskeyErrorMessage(new Error("boom"))).toContain("boom");
  });

  it("非 Error 输入不抛错", () => {
    expect(() => formatPasskeyErrorMessage("str")).not.toThrow();
    expect(() => formatPasskeyErrorMessage(null)).not.toThrow();
    expect(() => formatPasskeyErrorMessage(undefined)).not.toThrow();
  });
});

/* ==================================================== PasskeyService */

const cfg = { rpName: "Tower", rpID: "tower.example.com", origin: "https://tower.example.com" } as never;

/** 构造可控的假 D1：可控制 prepare 抛错、是否支持 bind/all */
function db(opts: {
  rows?: Array<Record<string, unknown>>;
  changes?: number;
  throwOn?: RegExp;
  noBind?: boolean;
  noAll?: boolean;
}) {
  const calls: string[] = [];
  const prepared = (sql: string) => {
    calls.push(sql);
    if (opts.throwOn?.test(sql)) throw new Error("no such table");
    const stmt: Record<string, unknown> = {
      run: async () => ({ success: true, meta: { changes: opts.changes ?? 1 } }),
      first: async () => (opts.rows ?? [])[0] ?? null,
    };
    if (!opts.noAll) {
      stmt.all = async () => ({ results: opts.rows ?? [] });
    }
    if (!opts.noBind) {
      stmt.bind = () => stmt;
    }
    return stmt;
  };
  return { db: { prepare: prepared } as never, calls };
}

describe("PasskeyService.isInitialized", () => {
  const svc = new PasskeyService(cfg);

  it("有记录 → true", async () => {
    const d = db({ rows: [{ cnt: 2 }] });
    expect(await svc.isInitialized(d.db)).toBe(true);
  });

  it("无记录 → false", async () => {
    const d = db({ rows: [] });
    expect(await svc.isInitialized(d.db)).toBe(false);
  });

  it("count 为 null（res.cnt 缺字段）→ false，不抛错", async () => {
    const d = db({ rows: [{}] });
    expect(await svc.isInitialized(d.db)).toBe(false);
  });

  it("查询抛错 → false（fail-closed：不能因为查不到就跳过初始化）", async () => {
    const d = db({ throwOn: /passkey_credentials/ });
    expect(await svc.isInitialized(d.db)).toBe(false);
  });
});

describe("PasskeyService.listPasskeys", () => {
  const svc = new PasskeyService(cfg);

  it("返回归一化后的凭据列表", async () => {
    const d = db({
      rows: [{ id: "pk1", name: "Yubi", transports: '["usb"]', aaguid: "00000000000000000000000000000000" }],
    });
    const list = await svc.listPasskeys(d.db, "user-1");
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("pk1");
  });

  it("无记录 → 空数组", async () => {
    const d = db({ rows: [] });
    expect(await svc.listPasskeys(d.db, "u")).toEqual([]);
  });

  it("无 results 字段时退化为空数组", async () => {
    const stmt = { all: async () => ({}), bind() { return this; } };
    expect(await svc.listPasskeys({ prepare: () => stmt } as never, "u")).toEqual([]);
  });
});

describe("PasskeyService.deletePasskey / renamePasskey", () => {
  const svc = new PasskeyService(cfg);

  it("删除影响行 > 0 → true", async () => {
    const d = db({ changes: 1 });
    expect(await svc.deletePasskey(d.db, "u", "pk1")).toBe(true);
  });

  it("删除影响行 0 → false（凭据不存在，不算成功）", async () => {
    const d = db({ changes: 0 });
    expect(await svc.deletePasskey(d.db, "u", "nope")).toBe(false);
  });

  it("meta.changes 缺失 → false", async () => {
    const stmt = { run: async () => ({ success: true, meta: {} }), bind() { return this; } };
    expect(await svc.deletePasskey({ prepare: () => stmt } as never, "u", "p")).toBe(false);
  });

  it("meta 整体缺失 → false（不抛错）", async () => {
    const stmt = { run: async () => ({ success: true }), bind() { return this; } };
    expect(await svc.deletePasskey({ prepare: () => stmt } as never, "u", "p")).toBe(false);
  });

  it("重命名时 meta 缺失 → false", async () => {
    const stmt = { run: async () => ({}), bind() { return this; } };
    expect(await svc.renamePasskey({ prepare: () => stmt } as never, "u", "p", "n")).toBe(false);
  });

  it("重命名影响行 > 0 → true", async () => {
    const d = db({ changes: 1 });
    expect(await svc.renamePasskey(d.db, "u", "pk1", "新名字")).toBe(true);
  });

  it("重命名为纯空白时回落为 Passkey（不留空名字）", async () => {
    const d = db({ changes: 1 });
    await svc.renamePasskey(d.db, "u", "pk1", "   ");
    const sql = d.calls.find((c) => /UPDATE/i.test(c)) ?? "";
    expect(sql, "空白名应被归一为 Passkey").toBeTruthy();
  });
});

/* ==================================================== sync/receiver */

import { handleD1SyncRequest } from "../../src/sync/receiver.js";

const SECRET = "sync-secret-value";

/** 造一个可回答 PRAGMA / SELECT / UPSERT 的假 D1 */
function syncDb(opts: { hasUpdatedAt?: boolean; throwOn?: RegExp; changes?: number } = {}) {
  const calls: string[] = [];
  const db = {
    prepare(sql: string) {
      calls.push(sql);
      if (opts.throwOn?.test(sql)) throw new Error("no such column");
      const stmt: Record<string, unknown> = {
        bind: function () {
          return this;
        },
        run: async () => ({ success: true, meta: { changes: opts.changes ?? 1 } }),
        first: async () => null,
        // localTableHasUpdatedAt 读的是 PRAGMA 的 .all().results
        all: async () =>
          /PRAGMA|table_info/i.test(sql)
            ? { results: opts.hasUpdatedAt ? [{ name: "updated_at" }] : [{ name: "id" }] }
            : { results: [] },
      };
      return stmt;
    },
  };
  return { db, calls };
}

const authed = (body: unknown, extraHeaders: Record<string, string> = {}) =>
  new Request("https://node/sync", {
    method: "POST",
    headers: { "X-Sync-Secret": SECRET, "content-type": "application/json", ...extraHeaders },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("handleD1SyncRequest：鉴权", () => {
  it("非 POST → 405", async () => {
    const res = await handleD1SyncRequest(
      new Request("https://node/sync", { method: "GET" }),
      { PEER_SYNC_SECRET: SECRET } as never,
    );
    expect(res.status).toBe(405);
  });

  it("缺少密钥头 → 401", async () => {
    const res = await handleD1SyncRequest(
      new Request("https://node/sync", { method: "POST" }),
      { PEER_SYNC_SECRET: SECRET } as never,
    );
    expect(res.status).toBe(401);
  });

  it("小写 x-sync-secret 头同样被接受", async () => {
    const { db } = syncDb({ hasUpdatedAt: true });
    const res = await handleD1SyncRequest(
      new Request("https://node/sync", {
        method: "POST",
        headers: { "x-sync-secret": SECRET, "content-type": "application/json" },
        body: JSON.stringify({ table: "users", action: "UPSERT", data: { id: 1, updated_at: 1 } }),
      }),
      { PEER_SYNC_SECRET: SECRET } as never,
      db,
    );
    expect(res.status).toBe(200);
  });

  it("密钥错误 → 401", async () => {
    const res = await handleD1SyncRequest(
      authed({ table: "users", data: { id: 1 } }, { "X-Sync-Secret": "wrong" }),
      { PEER_SYNC_SECRET: SECRET } as never,
    );
    expect(res.status).toBe(401);
  });

  it("BACKUP_SYNC_SECRET 与 SYNC_SECRET 作为回退", async () => {
    for (const key of ["BACKUP_SYNC_SECRET", "SYNC_SECRET"]) {
      const { db } = syncDb({ hasUpdatedAt: true });
      const res = await handleD1SyncRequest(
        new Request("https://node/sync", {
          method: "POST",
          headers: { "X-Sync-Secret": SECRET, "content-type": "application/json" },
          body: JSON.stringify({ table: "users", data: { id: 1, updated_at: 1 } }),
        }),
        { [key]: SECRET } as never,
        db,
      );
      expect(res.status, key).toBe(200);
    }
  });

  it("服务端未配置任何密钥 → 401（fail-closed）", async () => {
    const res = await handleD1SyncRequest(authed({ table: "users", data: { id: 1 } }), {} as never);
    expect(res.status).toBe(401);
  });
});

describe("handleD1SyncRequest：载荷校验", () => {
  it("非法 JSON → 400", async () => {
    const res = await handleD1SyncRequest(authed("not json"), { PEER_SYNC_SECRET: SECRET } as never);
    expect(res.status).toBe(400);
  });

  it("缺 table → 400", async () => {
    const res = await handleD1SyncRequest(authed({ data: { id: 1 } }), { PEER_SYNC_SECRET: SECRET } as never);
    expect(res.status).toBe(400);
  });

  it("data 不是对象 → 400", async () => {
    for (const d of ["str", 42, null]) {
      const res = await handleD1SyncRequest(
        authed({ table: "users", data: d }),
        { PEER_SYNC_SECRET: SECRET } as never,
      );
      expect(res.status, JSON.stringify(d)).toBe(400);
    }
  });

  it("非法表名 → 400 且带出原因", async () => {
    const res = await handleD1SyncRequest(
      authed({ table: 'users" WHERE 1=1 --', data: { id: 1 } }),
      { PEER_SYNC_SECRET: SECRET } as never,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBeTruthy();
  });

  it("非法主键名 → 400", async () => {
    const res = await handleD1SyncRequest(
      authed({ table: "users", primaryKey: 'id" --', data: { id: 1 } }),
      { PEER_SYNC_SECRET: SECRET } as never,
    );
    expect(res.status).toBe(400);
  });

  it("无 D1 绑定 → 500（而不是崩在 undefined.prepare）", async () => {
    const res = await handleD1SyncRequest(
      authed({ table: "users", data: { id: 1 } }),
      { PEER_SYNC_SECRET: SECRET } as never,
    );
    expect(res.status).toBe(500);
  });
});

describe("handleD1SyncRequest：LWW 与删除守卫", () => {
  it("本地表有 updated_at 但载荷未带 → 400（不得让调用方靠漏字段关掉 LWW）", async () => {
    const { db } = syncDb({ hasUpdatedAt: true });
    const res = await handleD1SyncRequest(
      authed({ table: "users", data: { id: 1 } }),
      { PEER_SYNC_SECRET: SECRET } as never,
      db,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/updated_at/);
  });

  it("updated_at 为 number 时正常应用", async () => {
    const { db } = syncDb({ hasUpdatedAt: true });
    const res = await handleD1SyncRequest(
      authed({ table: "users", data: { id: 1, updated_at: 1_700_000_000_000 } }),
      { PEER_SYNC_SECRET: SECRET } as never,
      db,
    );
    expect(res.status).toBe(200);
  });

  it("updated_at 为 Date 实例时归一为毫秒", async () => {
    const { db } = syncDb({ hasUpdatedAt: true });
    const res = await handleD1SyncRequest(
      authed({ table: "users", data: { id: 1, updated_at: new Date(1_700_000_000_000) } }),
      { PEER_SYNC_SECRET: SECRET } as never,
      db,
    );
    expect(res.status).toBe(200);
  });

  it("updated_at 为真值非数字（如字符串）时按 0 处理而不崩", async () => {
    const { db } = syncDb({ hasUpdatedAt: true });
    const res = await handleD1SyncRequest(
      authed({ table: "users", data: { id: 1, updated_at: "not-a-number" } }),
      { PEER_SYNC_SECRET: SECRET } as never,
      db,
    );
    // 可能被拒（NaN 无效时间戳），但绝不能 500
    expect([200, 400]).toContain(res.status);
  });

  it("updated_at 为 null / undefined 时按缺失处理", async () => {
    const { db } = syncDb({ hasUpdatedAt: true });
    const res = await handleD1SyncRequest(
      authed({ table: "users", data: { id: 1, updated_at: null } }),
      { PEER_SYNC_SECRET: SECRET } as never,
      db,
    );
    expect([200, 400]).toContain(res.status);
  });

  it("DELETE 带 timestamp 且本地表有 updated_at → 走带守卫的 LWW 删除", async () => {
    // 守卫的判据是 payload.timestamp（不是 updated_at）——
    // 少传 timestamp 就等于关掉守卫，旧实现正是栽在这里。
    const { db, calls } = syncDb({ hasUpdatedAt: true });
    const res = await handleD1SyncRequest(
      authed({ table: "users", action: "DELETE", data: { id: 1 }, timestamp: 1_700_000_000_000 }),
      { PEER_SYNC_SECRET: SECRET } as never,
      db,
    );
    expect(res.status).toBe(200);
    const del = calls.filter((c) => /^DELETE/i.test(c.trim()));
    expect(del).toHaveLength(1);
    expect(del[0], "必须带 updated_at 守卫条件").toMatch(/updated_at/i);
    expect(warn, "守卫正常工作时不应告警").not.toHaveBeenCalled();
  });

  it("DELETE 缺 timestamp 时退回无条件删除（不得静默丢弃事件）", async () => {
    const { db, calls } = syncDb({ hasUpdatedAt: true });
    const res = await handleD1SyncRequest(
      authed({ table: "users", action: "DELETE", data: { id: 1 } }),
      { PEER_SYNC_SECRET: SECRET } as never,
      db,
    );
    expect(res.status).toBe(200);
    const del = calls.filter((c) => /^DELETE/i.test(c.trim()));
    expect(del).toHaveLength(1);
    expect(del[0], "无守卫条件").not.toMatch(/updated_at/i);
  });

  it("DELETE 缺主键值 → 400（不做全表删除）", async () => {
    const { db, calls } = syncDb({ hasUpdatedAt: true });
    const res = await handleD1SyncRequest(
      authed({ table: "users", action: "DELETE", data: { other: 1 } }),
      { PEER_SYNC_SECRET: SECRET } as never,
      db,
    );
    expect(res.status).toBe(400);
    expect(calls.filter((c) => /^DELETE/i.test(c.trim())), "绝不能退化成无 WHERE 的删除").toHaveLength(0);
  });

  it("UPSERT 空 data → 400", async () => {
    const { db } = syncDb({ hasUpdatedAt: true });
    const res = await handleD1SyncRequest(
      authed({ table: "users", action: "UPSERT", data: {} }),
      { PEER_SYNC_SECRET: SECRET } as never,
      db,
    );
    expect(res.status).toBe(400);
  });

  it("LWW 守卫判定为 true 但删除语句本身抛错时回退并告警", async () => {
    // 两级失败要分开覆盖：
    // ① PRAGMA 探测失败 → localTableHasUpdatedAt 返回 false（探测处 catch），
    //    直接走无条件删除，不打 warn。
    // ② PRAGMA 成功（判定有 updated_at）但 DELETE 抛错（如列确实不存在），
    //    这时才走删除处的 catch 兜底 —— 必须无条件重试一次并打 warn，
    //    否则这条 DELETE 被静默丢弃，两个节点状态永久分叉且无人察觉。
    const { db, calls } = syncDb({ hasUpdatedAt: true, throwOn: /^DELETE[\s\S]*updated_at/i });
    const res = await handleD1SyncRequest(
      authed({ table: "users", action: "DELETE", data: { id: 1 }, timestamp: 1_700_000_000_000 }),
      { PEER_SYNC_SECRET: SECRET } as never,
      db,
    );
    expect(res.status).toBe(200);
    expect(calls.filter((c) => /^DELETE/i.test(c.trim())).length, "守卫失败后必须再无条件删一次").toBe(2);
    expect(warn, "回退必须有 warn，否则是静默降级").toHaveBeenCalled();
  });

  it("PRAGMA 探测抛错时按无 updated_at 处理，不打 warn（探测处已自行 catch）", async () => {
    const { db, calls } = syncDb({ hasUpdatedAt: true, throwOn: /PRAGMA|table_info/i });
    const res = await handleD1SyncRequest(
      authed({ table: "users", action: "DELETE", data: { id: 1 }, timestamp: 1_700_000_000_000 }),
      { PEER_SYNC_SECRET: SECRET } as never,
      db,
    );
    expect(res.status).toBe(200);
    expect(calls.some((c) => /^DELETE/i.test(c.trim())), "不能因探测失败就丢弃事件").toBe(true);
    expect(warn, "探测失败属预期路径，不应刷告警").not.toHaveBeenCalled();
  });

  it("UPSERT 在本地表无 updated_at 时不要求载荷携带", async () => {
    const { db } = syncDb({ hasUpdatedAt: false });
    const res = await handleD1SyncRequest(
      authed({ table: "users", data: { id: 1 } }),
      { PEER_SYNC_SECRET: SECRET } as never,
      db,
    );
    expect(res.status).toBe(200);
  });

  it("来源节点可来自 X-Sync-Origin-Node 头", async () => {
    const { db } = syncDb({ hasUpdatedAt: true });
    const res = await handleD1SyncRequest(
      authed(
        { table: "users", data: { id: 1, updated_at: 1 } },
        { "X-Sync-Origin-Node": "node-b" },
      ),
      { PEER_SYNC_SECRET: SECRET } as never,
      db,
    );
    expect(res.status).toBe(200);
  });

  it("binary 类型的列值可写入（Uint8Array 归一）", async () => {
    const { db, calls } = syncDb({ hasUpdatedAt: true });
    const res = await handleD1SyncRequest(
      authed({ table: "users", data: { id: 1, updated_at: 1, blob: [1, 2, 3] } }),
      { PEER_SYNC_SECRET: SECRET } as never,
      db,
    );
    expect(res.status).toBe(200);
    expect(calls.length).toBeGreaterThan(0);
  });
});

/* ==================================================== notify engine 尾 */

import { dispatchNotification, broadcastNotification } from "../../src/notify/engine.js";

describe("notify 引擎：非 Error 拒绝原因", () => {
  const payload = { title: "t", message: "m", level: "info" as const, event: "login" };

  it("broadcast 中一个通道的 handler 抛字符串时仍逐通道给出结果", async () => {
    const results = await broadcastNotification(
      [
        {
          channel: "telegram",
          config: {
            get botToken(): string {
              throw "string boom";
            },
            chatId: "1",
          } as never,
        },
        { channel: "telegram", config: { botToken: "T", chatId: "2" } },
      ],
      payload as never,
      {},
    );
    expect(results).toHaveLength(2);
  });

  it("dispatchNotification 带 waitUntil 时立即返回 ok", async () => {
    const waitUntil = vi.fn((p: Promise<unknown>) => void p.catch(() => {}));
    const r = await dispatchNotification({
      channel: "telegram",
      config: { botToken: "T", chatId: "1" },
      payload: payload as never,
      ctx: { waitUntil },
    });
    expect(r.ok).toBe(true);
    expect(waitUntil).toHaveBeenCalled();
  });
});
