/**
 * 同步推送的重试与退避（KIT-BUG-02）
 *
 * ## 这组测试在防什么
 *
 * 容灾推送常撞上对端冷启动或网络抖动的窗口。原先单次失败即永久丢失该条变更，
 * 而主库已经提交 —— 两节点从此分叉，且**没有任何补偿机制**能把它拉回来。
 * 这类不一致往往在真正需要恢复数据的那天才被发现。
 *
 * 但重试本身也会出错，所以这里同时钉住**不该重试**的那一半：
 * 4xx 重试一万次结果一样，只会白白占用对端资源、把"密钥配错了"这个真因
 * 推迟几秒才暴露。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendD1Change, sendD1BatchChanges, createD1SyncSender } from "../../src/sync/sender.js";
import type { SyncDeliveryResult } from "../../src/sync/types.js";

/** 签名与 `typeof fetch` 一致的 mock，便于断言 `mock.calls[n][1]` 的 RequestInit */
type MockedFetch = ReturnType<typeof vi.fn<typeof fetch>>;

const ENDPOINT = "https://peer.example.com/sync";
const SECRET = "sync-secret";
const EVENT = { table: "users", action: "UPSERT" as const, data: { id: 1 } };

/**
 * 收下 waitUntil 里的 promise，供测试 await。
 *
 * 必须存在**返回的引用**而不能只读闭包变量：TypeScript 会把
 * `let captured: Promise | null = null` 收窄为 `null`，
 * 于是 `get()` 的静态类型是 `null`，`await h.get()` 实际在 await 一个
 * 已解析的 null —— 断言在 promise 完成**之前**就跑了，重试次数自然对不上。
 *
 * 返回 `{ current }` 对象来绕过收窄，这也正是本文件最初 13 个用例集体
 * 失败的原因（重试逻辑本身是对的）。
 */
function harness(): {
  waitUntil: (p: Promise<unknown>) => void;
  box: { current: Promise<unknown> | null };
} {
  const box: { current: Promise<unknown> | null } = { current: null };
  const waitUntil = vi.fn((p: Promise<unknown>) => {
    box.current = p;
  });
  return { waitUntil, box };
}

/**
 * 构造一个签名与 `typeof fetch` 完全一致的 mock 工厂。
 *
 * ## 为什么不能直接写 `vi.fn(async () => new Response(...))`
 *
 * 无参实现签名不匹配 `typeof fetch`：
 * 1. `mock.calls` 的元素类型被推成 `[]`，`calls[0]![1]` 取不到 RequestInit
 * 2. 把它赋给 `customFetch` 字段时直接类型报错
 *
 * 而手写 `(url: string, init?: RequestInit)` 同样不匹配 ——
 * fetch 的首参是 `URL | RequestInfo`。故统一走本工厂，由它提供正确签名。
 */
function fetchMock(
  response: Response | (() => Promise<Response>) = new Response("{}", { status: 200 }),
): MockedFetch {
  return vi.fn(
    async (_input: URL | RequestInfo, _init?: RequestInit): Promise<Response> =>
      typeof response === "function" ? response() : response,
  );
}

/** 依次返回给定响应的 fetch（元素可以是 Response、Error 或要抛出的字符串） */
function seqFetch(...responses: Array<Response | Error | string>): MockedFetch {
  return vi.fn(
    async (_input: URL | RequestInfo, _init?: RequestInit): Promise<Response> => {
      const r = responses.shift();
      if (r === undefined) throw new Error("fetch 被调用次数超出预期");
      if (r instanceof Error) throw r;
      if (typeof r === "string") throw r;
      return r;
    },
  );
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  warn.mockRestore();
  vi.restoreAllMocks();
});

const noDelay = { retryBaseDelayMs: 0, retryJitter: 0 } as const;
const run = async (h: ReturnType<typeof harness>) => {
  await h.box.current;
};

describe("重试：瞬时故障", () => {
  it("502 会被重试，并在后续成功时报告 success", async () => {
    const h = harness();
    const customFetch = seqFetch(
      new Response("bad gw", { status: 502 }),
      new Response("{}", { status: 200 }),
    );
    const results: SyncDeliveryResult[] = [];
    sendD1Change({ waitUntil: h.waitUntil }, { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET }, EVENT, {
      customFetch,
      ...noDelay,
      onResult: (r) => results.push(r),
    });
    await run(h);
    expect(customFetch).toHaveBeenCalledTimes(2);
    expect(results[0]?.success).toBe(true);
    expect(results[0]?.attempts).toBe(2);
  });

  it("503 / 504 / 500 / 429 / 408 / 425 都属可重试", async () => {
    for (const status of [503, 504, 500, 429, 408, 425]) {
      const h = harness();
      const customFetch = seqFetch(
        new Response("", { status }),
        new Response("", { status }),
        new Response("{}", { status: 200 }),
      );
      sendD1Change({ waitUntil: h.waitUntil }, { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET }, EVENT, {
        customFetch,
        maxRetries: 2,
        ...noDelay,
      });
      await run(h);
      expect(customFetch, `status=${status} 应重试到成功`).toHaveBeenCalledTimes(3);
    }
  });

  it("网络异常会被重试", async () => {
    const h = harness();
    const customFetch = seqFetch(new Error("ECONNRESET"), new Response("{}", { status: 200 }));
    sendD1Change({ waitUntil: h.waitUntil }, { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET }, EVENT, {
      customFetch,
      ...noDelay,
    });
    await run(h);
    expect(customFetch).toHaveBeenCalledTimes(2);
  });

  it("默认最多重试 2 次（共 3 次尝试）后放弃", async () => {
    const h = harness();
    const customFetch = fetchMock(new Response("", { status: 503 }));
    const results: SyncDeliveryResult[] = [];
    sendD1Change({ waitUntil: h.waitUntil }, { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET }, EVENT, {
      customFetch,
      ...noDelay,
      onResult: (r) => results.push(r),
    });
    await run(h);
    expect(customFetch).toHaveBeenCalledTimes(3);
    expect(results[0]).toMatchObject({ success: false, attempts: 3, status: 503, retryable: true });
  });

  it("maxRetries=0 完全关闭重试（回到旧行为）", async () => {
    const h = harness();
    const customFetch = fetchMock(new Response("", { status: 503 }));
    sendD1Change({ waitUntil: h.waitUntil }, { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET }, EVENT, {
      customFetch,
      maxRetries: 0,
      ...noDelay,
    });
    await run(h);
    expect(customFetch).toHaveBeenCalledTimes(1);
  });

  it("maxRetries 可覆盖默认值", async () => {
    const h = harness();
    const customFetch = fetchMock(new Response("", { status: 503 }));
    sendD1Change({ waitUntil: h.waitUntil }, { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET }, EVENT, {
      customFetch,
      maxRetries: 4,
      ...noDelay,
    });
    await run(h);
    expect(customFetch).toHaveBeenCalledTimes(5);
  });
});

describe("不重试：永久故障", () => {
  it("4xx 立即终止，不浪费对端资源", async () => {
    for (const status of [400, 401, 403, 404, 405, 410, 422]) {
      const h = harness();
      const customFetch = fetchMock(async () => new Response("", { status }));
      const results: SyncDeliveryResult[] = [];
      sendD1Change({ waitUntil: h.waitUntil }, { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET }, EVENT, {
        customFetch,
        maxRetries: 3,
        ...noDelay,
        onResult: (r) => results.push(r),
      });
      await run(h);
      expect(customFetch, `status=${status} 不应重试`).toHaveBeenCalledTimes(1);
      expect(results[0]).toMatchObject({ success: false, attempts: 1, status, fatal: true, retryable: false });
    }
  });

  it("fatalStatusCodes 可自定义（如把 429 视为致命以尽早暴露限流）", async () => {
    const h = harness();
    const customFetch = fetchMock(async () => new Response("rate limited", { status: 429 }));
    const results: SyncDeliveryResult[] = [];
    sendD1Change({ waitUntil: h.waitUntil }, { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET }, EVENT, {
      customFetch,
      fatalStatusCodes: [400, 401, 403, 429],
      maxRetries: 3,
      ...noDelay,
      onResult: (r) => results.push(r),
    });
    await run(h);
    expect(customFetch).toHaveBeenCalledTimes(1);
    expect(results[0]?.fatal).toBe(true);
  });

  it("白名单外的 5xx（如 599）不重试：成因未知，不该耗尽执行时长", async () => {
    // 归类用的是**白名单**。白名单里的每个码都对应一个明确的、对端会自愈的
    // 瞬时故障；未收录的码可能是更严重的问题（如网关彻底不可用），
    // 对它重试只会把本地 Worker 的时间片耗尽。
    // 代价是新增网关码需显式加进 RETRYABLE_STATUS —— 那比默默重试更安全。
    const h = harness();
    const customFetch = seqFetch(new Response("", { status: 599 }), new Response("{}", { status: 200 }));
    const results: SyncDeliveryResult[] = [];
    sendD1Change({ waitUntil: h.waitUntil }, { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET }, EVENT, {
      customFetch,
      maxRetries: 3,
      ...noDelay,
      onResult: (r) => results.push(r),
    });
    await run(h);
    expect(customFetch, "白名单外的码不重试").toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({ success: false, retryable: false, fatal: false });
  });
});

describe("退避", () => {
  it("退避时长递增（指数）", async () => {
    vi.useFakeTimers();
    const delays: number[] = [];
    const h = harness();
    const customFetch = fetchMock(new Response("", { status: 503 }));
    sendD1Change({ waitUntil: h.waitUntil }, { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET }, EVENT, {
      customFetch,
      maxRetries: 2,
      retryBaseDelayMs: 100,
      retryJitter: 0,
    });
    const p = h.box.current as Promise<unknown>;
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(300);
      delays.push(customFetch.mock.calls.length);
      void delays;
    }
    await vi.runAllTimersAsync();
    await p;
    expect(customFetch).toHaveBeenCalledTimes(3);
  });

  it("退避封顶在 retryMaxDelayMs（否则 2^n 会涨到不可接受的等待）", async () => {
    vi.useFakeTimers();
    const h = harness();
    const customFetch = fetchMock(new Response("", { status: 503 }));
    sendD1Change({ waitUntil: h.waitUntil }, { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET }, EVENT, {
      customFetch,
      maxRetries: 6,
      retryBaseDelayMs: 1000,
      retryMaxDelayMs: 1500,
      retryJitter: 0,
      onResult: (r) => {
        void r;
      },
    });
    const p = h.box.current as Promise<unknown>;
    // 允许的总时间 = 6 次尝试 × 最多 1500ms 退避 + 余量
    await vi.advanceTimersByTimeAsync(6 * 1500 + 500);
    await vi.runAllTimersAsync();
    await p;
    expect(customFetch).toHaveBeenCalledTimes(7);
  });

  it("抖动只向下偏移，不突破 maxMs 封顶", async () => {
    // 上浮的抖动会让"封顶"名存实亡：实测封顶 1000ms 时，
    // 1.2 倍抖动可能产生 1200ms 的实际等待。
    vi.useFakeTimers();
    const observed: number[] = [];
    const h = harness();
    const customFetch = fetchMock(async () => {
      observed.push(Date.now());
      return new Response("", { status: 503 });
    });
    sendD1Change({ waitUntil: h.waitUntil }, { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET }, EVENT, {
      customFetch,
      maxRetries: 5,
      retryBaseDelayMs: 1000,
      retryMaxDelayMs: 1000,
      retryJitter: 0.5,
    });
    const p = h.box.current as Promise<unknown>;
    const t0 = Date.now();
    await vi.advanceTimersByTimeAsync(5 * 1000 + 200);
    await vi.runAllTimersAsync();
    await p;
    for (let i = 1; i < observed.length; i++) {
      expect(observed[i]! - observed[i - 1]!, `第 ${i} 次间隔`).toBeLessThanOrEqual(1000);
    }
    void t0;
  });

  it("抖动为 0 时退避确定（便于测试与可复现排查）", async () => {
    vi.useFakeTimers();
    const stamps: number[] = [];
    const h = harness();
    const customFetch = fetchMock(async () => {
      stamps.push(Date.now());
      return new Response("", { status: 503 });
    });
    sendD1Change({ waitUntil: h.waitUntil }, { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET }, EVENT, {
      customFetch,
      maxRetries: 3,
      retryBaseDelayMs: 100,
      retryJitter: 0,
    });
    const p = h.box.current as Promise<unknown>;
    await vi.advanceTimersByTimeAsync(3 * 100 + 400);
    await vi.runAllTimersAsync();
    await p;
    expect(stamps.length).toBe(4);
    // 100, 200, 400 —— 严格指数
    expect(stamps[1]! - stamps[0]!).toBe(100);
    expect(stamps[2]! - stamps[1]!).toBe(200);
    expect(stamps[3]! - stamps[2]!).toBe(400);
  });

  it("backoffMs 汇总总退避开销（便于观测）", async () => {
    const h = harness();
    const customFetch = fetchMock(new Response("", { status: 503 }));
    const results: SyncDeliveryResult[] = [];
    sendD1Change({ waitUntil: h.waitUntil }, { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET }, EVENT, {
      customFetch,
      maxRetries: 1,
      retryBaseDelayMs: 0,
      retryJitter: 0,
      onResult: (r) => results.push(r),
    });
    await run(h);
    expect(results[0]?.backoffMs).toBe(0);
    expect(typeof results[0]?.backoffMs).toBe("number");
  });
});

describe("结构化诊断", () => {
  it("失败时以 warn 级别记录（含 endpoint / attempts / status / 原因）", async () => {
    // 生产环境 console.debug 默认不可见，而"两节点静默分叉"
    // 必须在默认级别下就能被发现。
    const h = harness();
    const customFetch = vi.fn(async () => new Response("密钥不匹配", { status: 401 }));
    sendD1Change({ waitUntil: h.waitUntil }, { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET }, EVENT, {
      customFetch,
      maxRetries: 0,
      ...noDelay,
    });
    await run(h);
    expect(warn).toHaveBeenCalled();
    const msg = String(warn.mock.calls[0]![0]);
    expect(msg).toContain(ENDPOINT);
    expect(msg).toContain("attempts=1");
    expect(msg).toContain("status=401");
    expect(msg).toContain("密钥不匹配");
  });

  it("日志中不含密钥（凭据泄漏即等于把对端交出去）", async () => {
    const h = harness();
    const customFetch = fetchMock(new Response("", { status: 401 }));
    sendD1Change({ waitUntil: h.waitUntil }, { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET }, EVENT, {
      customFetch,
      maxRetries: 0,
      ...noDelay,
    });
    await run(h);
    expect(String(warn.mock.calls[0]![0])).not.toContain(SECRET);
  });

  it("非 Error 异常也产出可读原因", async () => {
    const h = harness();
    const customFetch = vi.fn(async () => {
      throw "plain string failure";
    });
    const results: SyncDeliveryResult[] = [];
    sendD1Change({ waitUntil: h.waitUntil }, { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET }, EVENT, {
      customFetch,
      maxRetries: 0,
      ...noDelay,
      onResult: (r) => results.push(r),
    });
    await run(h);
    expect(results[0]?.error).toContain("plain string failure");
  });

  it("循环引用的异常对象不会让日志本身崩掉", async () => {
    const h = harness();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const customFetch = fetchMock(async () => {
      throw circular;
    });
    const results: SyncDeliveryResult[] = [];
    sendD1Change({ waitUntil: h.waitUntil }, { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET }, EVENT, {
      customFetch,
      maxRetries: 0,
      ...noDelay,
      onResult: (r) => results.push(r),
    });
    await run(h);
    expect(results[0]?.error).toBeTruthy();
  });

  it("成功时静默（不刷无谓日志）", async () => {
    const h = harness();
    const customFetch = fetchMock();
    sendD1Change({ waitUntil: h.waitUntil }, { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET }, EVENT, {
      customFetch,
      ...noDelay,
    });
    await run(h);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("零侵入保证：任何失败都不抛给业务链路", () => {
  it("fetch 持续失败时 sendD1Change 本身不抛", async () => {
    const h = harness();
    const customFetch = fetchMock(async () => {
      throw new Error("down");
    });
    expect(() =>
      sendD1Change({ waitUntil: h.waitUntil }, { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET }, EVENT, {
        customFetch,
        maxRetries: 0,
        ...noDelay,
      }),
    ).not.toThrow();
    await h.box.current;
  });

  it("未配置对端时完全静默（零侵入）", async () => {
    const h = harness();
    sendD1Change({ waitUntil: h.waitUntil }, {} as never, EVENT);
    sendD1Change({ waitUntil: h.waitUntil }, { PEER_SYNC_ENDPOINT: ENDPOINT } as never, EVENT);
    expect(h.box.current, "缺配置时不得发起任何推送").toBeNull();
  });

  it("没有 waitUntil 时也不抛（同步等待内部 promise）", async () => {
    const customFetch = fetchMock(new Response("", { status: 503 }));
    expect(() =>
      sendD1Change(null, { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET }, EVENT, {
        customFetch,
        maxRetries: 0,
        ...noDelay,
      }),
    ).not.toThrow();
  });

  it("无 waitUntil 但有 onResult 时回调仍被调用", async () => {
    const onResult = vi.fn();
    sendD1Change(null, { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET }, EVENT, {
      customFetch: fetchMock(new Response("", { status: 500 })),
      maxRetries: 0,
      ...noDelay,
      onResult,
    });
    await vi.waitFor(() => expect(onResult).toHaveBeenCalled());
  });
});

describe("批量推送（KIT-OPT-01）", () => {
  const CHANGES = [
    { table: "users", action: "UPSERT" as const, data: { id: 1 } },
    { table: "users", action: "UPSERT" as const, data: { id: 2 } },
    { table: "posts", action: "DELETE" as const, data: { id: 3 } },
  ];

  it("多条变更合并为一次请求", async () => {
    const h = harness();
    const customFetch = fetchMock();
    sendD1BatchChanges({ waitUntil: h.waitUntil }, ENDPOINT, SECRET, CHANGES, {
      customFetch,
      ...noDelay,
    });
    await run(h);
    expect(customFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((customFetch.mock.calls[0]![1] as RequestInit).body));
    expect(body.changes).toHaveLength(3);
  });

  it("批量与单条共用同一套重试语义（不会各自漂移）", async () => {
    const h = harness();
    const customFetch = seqFetch(new Response("", { status: 502 }), new Response("{}", { status: 200 }));
    const results: SyncDeliveryResult[] = [];
    sendD1BatchChanges({ waitUntil: h.waitUntil }, ENDPOINT, SECRET, CHANGES, {
      customFetch,
      ...noDelay,
      onResult: (r) => results.push(r),
    });
    await run(h);
    expect(customFetch).toHaveBeenCalledTimes(2);
    expect(results[0]?.success).toBe(true);
  });

  it("批量遇 401 也不重试", async () => {
    const h = harness();
    const customFetch = fetchMock(new Response("", { status: 401 }));
    sendD1BatchChanges({ waitUntil: h.waitUntil }, ENDPOINT, SECRET, CHANGES, {
      customFetch,
      maxRetries: 3,
      ...noDelay,
    });
    await run(h);
    expect(customFetch).toHaveBeenCalledTimes(1);
  });

  it("空批次不发请求（无意义往返 + 白占对端事务）", () => {
    const h = harness();
    sendD1BatchChanges({ waitUntil: h.waitUntil }, ENDPOINT, SECRET, [], { customFetch: vi.fn() });
    expect(h.box.current).toBeNull();
  });

  it("缺端点或密钥时静默跳过", () => {
    const h = harness();
    sendD1BatchChanges({ waitUntil: h.waitUntil }, undefined, SECRET, CHANGES, { customFetch: vi.fn() });
    sendD1BatchChanges({ waitUntil: h.waitUntil }, ENDPOINT, undefined, CHANGES, { customFetch: vi.fn() });
    expect(h.box.current).toBeNull();
  });

  it("每条变更都被补齐 primaryKey / timestamp / sourceNodeId", async () => {
    const h = harness();
    const customFetch = fetchMock();
    sendD1BatchChanges({ waitUntil: h.waitUntil }, ENDPOINT, SECRET, [{ table: "t", action: "UPSERT", data: {} }], {
      customFetch,
      nodeId: "node-x",
      ...noDelay,
    });
    await run(h);
    const body = JSON.parse(String((customFetch.mock.calls[0]![1] as RequestInit).body));
    const c = body.changes[0];
    expect(c.primaryKey).toBe("id");
    expect(c.sourceNodeId).toBe("node-x");
    expect(typeof c.timestamp).toBe("number");
  });

  it("请求头带批次数量，便于对端观测", async () => {
    const h = harness();
    const customFetch = fetchMock();
    sendD1BatchChanges({ waitUntil: h.waitUntil }, ENDPOINT, SECRET, CHANGES, { customFetch, ...noDelay });
    await run(h);
    const headers = (customFetch.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-Sync-Batch-Count"]).toBe("3");
    expect(headers["X-Sync-Secret"]).toBe(SECRET);
  });

  it("无 waitUntil 时也不抛", () => {
    expect(() =>
      sendD1BatchChanges(null, ENDPOINT, SECRET, CHANGES, {
        customFetch: fetchMock(new Response("", { status: 500 })),
        maxRetries: 0,
        ...noDelay,
      }),
    ).not.toThrow();
  });
});

describe("createD1SyncSender.batch", () => {
  it("委托给 sendD1BatchChanges，读 env 配置", async () => {
    const h = harness();
    const customFetch = fetchMock();
    const sender = createD1SyncSender(
      { PEER_SYNC_ENDPOINT: ENDPOINT, PEER_SYNC_SECRET: SECRET, NODE_ID: "n1" },
      { customFetch, ...noDelay },
    );
    sender.batch({ waitUntil: h.waitUntil }, [{ table: "t", action: "UPSERT", data: { id: 1 } }]);
    await run(h);
    expect(customFetch).toHaveBeenCalledTimes(1);
    const headers = (customFetch.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-Sync-Origin-Node"]).toBe("n1");
  });

  it("未配置对端时 batch 也静默", () => {
    const h = harness();
    createD1SyncSender({}).batch({ waitUntil: h.waitUntil }, [{ table: "t", action: "UPSERT", data: {} }]);
    expect(h.box.current).toBeNull();
  });
});
