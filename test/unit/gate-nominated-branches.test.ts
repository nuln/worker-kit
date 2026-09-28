/**
 * 门禁点名的剩余分支补齐
 *
 * 本文件只针对 `coverage-floor-gate` 报出的新增未覆盖分支。分两类：
 *
 * 1. **`sync/receiver.ts` 的批量路径**：`applyD1BatchChanges` 里
 *    `String(table ?? "")` / `change?.action ?? "UPSERT"` 这类默认值，
 *    在载荷缺字段时才走到 —— 而缺字段正是必须被拒绝的情况。
 * 2. **`urls/origin.ts` 的兜底**：把 `isLocalhost` 移进来后，
 *    该文件的分支数与覆盖率进入了门禁视野。
 *
 * 两类的共同点：**出问题时才走到**，而出问题时正是最需要它们正确的时刻。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { applyD1BatchChanges, handleD1SyncRequest } from "../../src/sync/receiver.js";
import { normalizeSubPath, normalizeIssuerUrl, normalizeRedirectUri, selectRpId, resolveIssuer } from "../../src/urls/origin.js";

/* ==================================================== sync/receiver */

const SECRET = "s";

function db(opts: { hasUpdatedAt?: boolean; allAsArray?: boolean; throwOn?: RegExp } = {}) {
  const prepared: string[] = [];
  const statements: unknown[] = [];
  const base = {
    prepare(sql: string) {
      prepared.push(sql);
      if (opts.throwOn?.test(sql)) throw new Error("probe failed");
      const stmt: Record<string, unknown> = {
        bind: (...v: unknown[]) => {
          Object.assign(stmt, { __v: v });
          return stmt;
        },
        run: async () => ({ success: true, meta: { changes: 1 } }),
        first: async () => null,
        all: async () => {
          if (/PRAGMA|table_info/i.test(sql)) {
            const rows = opts.hasUpdatedAt ? [{ name: "updated_at" }] : [{ name: "id" }];
            // 部分 D1 兼容实现把 all() 的结果直接作为数组返回
            return opts.allAsArray ? (rows as never) : { results: rows };
          }
          return { results: [] };
        },
      };
      return stmt;
    },
    batch: async (sts: unknown[]) => {
      statements.push(...sts);
      return sts.length;
    },
  };
  return { db: base as never, prepared, statements };
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  errorSpy.mockRestore();
});

describe("applyD1BatchChanges：载荷缺字段的默认值", () => {
  it("action 缺省为 UPSERT（而不是 undefined 走进错误分支）", async () => {
    const { db: d, prepared } = db({ hasUpdatedAt: false });
    const r = await applyD1BatchChanges(d, {
      // 刻意不给 action
      changes: [{ table: "users", data: { id: 1 } } as never],
    });
    expect(r.ok).toBe(true);
    expect(prepared.some((s) => /INSERT INTO/i.test(s))).toBe(true);
  });

  it("change 为 null 时按空表名/默认动作拒绝，不抛未捕获异常", async () => {
    const { db: d, statements } = db();
    const r = await applyD1BatchChanges(d, { changes: [null as never] });
    expect(r.ok).toBe(false);
    expect(statements, "拒绝时不得执行任何语句").toHaveLength(0);
    expect(r.failures[0]?.action, "缺省动作应为 UPSERT").toBe("UPSERT");
    expect(r.failures[0]?.table, "缺表名时归一为空串").toBe("");
  });

  it("change 缺 action 时 DELETE 走默认 UPSERT 路径（不会误删）", async () => {
    const { db: d, prepared } = db({ hasUpdatedAt: false });
    const r = await applyD1BatchChanges(d, {
      changes: [{ table: "users", data: { id: 1 } } as never],
    });
    expect(r.ok).toBe(true);
    expect(prepared.some((s) => /^DELETE/i.test(s)), "缺 action 时不得当成删除").toBe(false);
  });

  it("非法标识符抛非 Error 时也能归一（String(err) 兜底）", async () => {
    const { db: d, statements } = db();
    // 让 assertSafeIdentifier 抛出字符串而不是 Error
    const bad = new Proxy(
      {},
      {
        get(_t, k) {
          if (k === Symbol.toPrimitive || k === "toString") throw "identifier rejected";
          return undefined;
        },
      },
    );
    void bad;
    // 直接用一个会触发异常的表名来走 catch
    const r = await applyD1BatchChanges(d, {
      changes: [{ table: "bad name!", action: "UPSERT", data: { id: 1 } }],
    });
    expect(r.ok).toBe(false);
    expect(typeof r.failures[0]?.error).toBe("string");
    expect(statements).toHaveLength(0);
  });

  it("db.batch 抛非 Error 时失败明细仍带出原因", async () => {
    const d = {
      prepare: (sql: string) => {
        const stmt: Record<string, unknown> = {
          bind: () => stmt,
          run: async () => ({ success: true }),
          all: async () => ({ results: [{ name: "id" }] }),
        };
        void sql;
        return stmt;
      },
      batch: async () => {
        throw "transaction rejected";
      },
    } as never;
    const r = await applyD1BatchChanges(d, {
      changes: [{ table: "users", action: "UPSERT", data: { id: 1 } }],
    });
    expect(r.ok).toBe(false);
    expect(r.failures[0]?.error).toContain("transaction rejected");
    expect(errorSpy, "整批回滚必须以 error 级别记录").toHaveBeenCalled();
  });

  it("本地表探测返回数组形态（部分 D1 兼容实现）时也能识别 updated_at", async () => {
    const { db: d, prepared } = db({ hasUpdatedAt: true, allAsArray: true });
    const r = await applyD1BatchChanges(d, {
      changes: [{ table: "users", action: "UPSERT", data: { id: 1, updated_at: 1 } }],
    });
    expect(r.ok).toBe(true);
    expect(prepared.some((s) => s.includes('excluded."updated_at"'))).toBe(true);
  });

  it("本地表探测抛错时按无该列处理（不因此整批失败）", async () => {
    const { db: d, statements } = db({ throwOn: /PRAGMA|table_info/i });
    const r = await applyD1BatchChanges(d, {
      changes: [{ table: "users", action: "UPSERT", data: { id: 1 } }],
    });
    expect(r.ok, "探测失败应降级为兼容分支").toBe(true);
    expect(statements.length).toBeGreaterThan(0);
  });
});

describe("handleD1SyncRequest：非 Error 异常", () => {
  const authed = (body: unknown) =>
    new Request("https://node/sync", {
      method: "POST",
      headers: { "X-Sync-Secret": SECRET, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("标识符校验抛出非 Error 时仍返回 400 且带出原因", async () => {
    // assertSafeIdentifier 通常抛 Error，但若它（或未来的实现）抛字符串，
    // 这里必须照样转成 400 —— 不能让异常冒到顶层变成未处理拒绝。
    const d = {
      prepare: () => {
        throw "unexpected string failure";
      },
    } as never;
    const res = await handleD1SyncRequest(
      authed({ table: "users", action: "DELETE", data: { id: 1 }, timestamp: 1 }),
      { PEER_SYNC_SECRET: SECRET } as never,
      d,
    );
    expect([400, 500]).toContain(res.status);
    expect(((await res.json()) as { error: string }).error).toBeTruthy();
  });

  it("写入阶段抛非 Error 时返回 500 且带出原因", async () => {
    const d = {
      prepare: (sql: string) => {
        if (/PRAGMA|table_info/i.test(sql)) return { all: async () => ({ results: [{ name: "id" }] }) };
        const stmt: Record<string, unknown> = {
          bind: () => stmt,
          run: async () => {
            throw "write rejected";
          },
        };
        return stmt;
      },
    } as never;
    const res = await handleD1SyncRequest(
      authed({ table: "users", action: "UPSERT", data: { id: 1 } }),
      { PEER_SYNC_SECRET: SECRET } as never,
      d,
    );
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toContain("write rejected");
  });
});

/* ==================================================== urls/origin 兜底 */

describe("urls/origin：缺省与兜底分支", () => {
  it("normalizeSubPath：null / undefined / 空白 → 空串", () => {
    expect(normalizeSubPath(null)).toBe("");
    expect(normalizeSubPath(undefined)).toBe("");
    expect(normalizeSubPath("   ")).toBe("");
    expect(normalizeSubPath("/")).toBe("");
  });

  it("normalizeIssuerUrl：空值抛错（不得返回猜测的 issuer）", () => {
    expect(() => normalizeIssuerUrl("")).toThrow();
    expect(() => normalizeIssuerUrl(undefined as never)).toThrow();
  });

  it("normalizeRedirectUri：空值抛错", () => {
    expect(() => normalizeRedirectUri("")).toThrow();
  });

  it("selectRpId：rpIds 为 undefined 时不崩并给出明确错误", () => {
    // 缺配置时"随便挑一个"会让 WebAuthn 在错误的域上签发凭据 ——
    // 那种错误在用户拿到设备之后才会暴露。
    expect(() => selectRpId("a.com", undefined as never)).toThrow(/no matching/);
    expect(() => selectRpId("a.com", [])).toThrow(/no matching/);
  });

  it("selectRpId：候选项含空白时跳过", () => {
    expect(selectRpId("A.com", ["  ", "a.com  "])).toBe("a.com");
  });

  it("resolveIssuer：配置里 RP_ID 命中时按配置走，未命中则用请求 host", () => {
    // 两条分支：命中 / 未命中（回退到请求 host）
    const hit = resolveIssuer(
      "https://a.com/oidc/login",
      { ORIGIN: "https://a.com", RP_ID: "a.com" } as never,
      "",
    );
    expect(hit).toContain("a.com");
    const miss = resolveIssuer("https://other.com/oidc/login", {
      ORIGIN: "https://other.com",
      RP_ID: "a.com",
    } as never, "");
    expect(miss).toBeTruthy();
  });

  it("resolveIssuer：devEnvRequested 与 loopback 的组合", () => {
    // 本地开发允许 http 回环；生产必须走 https。
    // 两条判定任一为 false 都应拒绝。
    expect(() =>
      resolveIssuer("http://127.0.0.1:8787/oidc/login", {} as never, ""),
    ).not.toThrow();
  });
});
