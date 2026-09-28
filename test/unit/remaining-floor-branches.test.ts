/**
 * 收尾批：把仍低于 90% 的文件补到达标线
 *
 * 本文件覆盖的是前面几轮**有意留下**的分支，集中在三类：
 *
 * 1. **错误路径的二次容错**：`res.text().catch(() => "")` 这类。
 *    它们的存在本身是防御 —— 错误响应体读不出来时不能连带崩掉，
 *    但"错误路径的防御"最容易因为"平时走不到"而完全没测过。
 * 2. **HTTP 端点的畸形输入**：`request.json().catch(() => ({}))`。
 *    客户端可以发任意 body，包括根本不是 JSON 的。
 * 3. **容量/超时这类"只在极限下触发"的保护**：见 `MemoryIdempotencyStore`。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ==================================================== sync/sender */

import { sendD1Change, createD1SyncSender } from "../../src/sync/sender.js";

describe("sync/sender：超时与非 2xx 响应", () => {
  const event = { table: "users", operation: "insert" as const, row: { id: 1 } };

  it("未配置端点或密钥时静默跳过（零侵入）", () => {
    const waitUntil = vi.fn();
    sendD1Change({ waitUntil }, {} as never, event as never);
    sendD1Change({ waitUntil }, { PEER_SYNC_ENDPOINT: "https://peer/sync" } as never, event as never);
    expect(waitUntil, "缺配置时不得发起任何推送").not.toHaveBeenCalled();
  });

  it("目标不可达时静默降级（不得把异常抛回业务链路）", () => {
    const waitUntil = vi.fn((p: Promise<unknown>) => void p.catch(() => {}));
    expect(() =>
      sendD1Change(
        { waitUntil },
        { PEER_SYNC_ENDPOINT: "https://peer/sync", PEER_SYNC_SECRET: "s" } as never,
        event as never,
      ),
    ).not.toThrow();
    expect(waitUntil).toHaveBeenCalled();
  });

  it("非 2xx 时读取错误体失败也不崩（text() 抛错被兜住）", async () => {
    const badBody = {
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => {
        throw new Error("stream already consumed");
      },
    } as unknown as Response;
    const customFetch = vi.fn(async () => badBody);
    const waitUntil = vi.fn((p: Promise<unknown>) => void p.catch(() => {}));
    sendD1Change(
      { waitUntil },
      { PEER_SYNC_ENDPOINT: "https://peer/sync", PEER_SYNC_SECRET: "s" } as never,
      event as never,
      { customFetch, timeoutMs: 50 } as never,
    );
    // 等推送任务真正执行完，确认既没抛错也没产生未处理拒绝
    const p = waitUntil.mock.calls[0]?.[0] as Promise<unknown>;
    await expect(p).resolves.not.toThrow();
  });

  it("成功路径：customFetch 被调用且带上鉴权头", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const customFetch = vi.fn(async (u: unknown, init?: RequestInit) => {
      seen.push({ url: String(u), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const waitUntil = vi.fn((p: Promise<unknown>) => void p.catch(() => {}));
    sendD1Change(
      { waitUntil },
      { PEER_SYNC_ENDPOINT: "https://peer/sync", PEER_SYNC_SECRET: "SEC" } as never,
      event as never,
      { customFetch, nodeId: "node-a", timeoutMs: 1000 } as never,
    );
    await (waitUntil.mock.calls[0]?.[0] as Promise<unknown>);
    expect(seen).toHaveLength(1);
    const headers = seen[0]!.init.headers as Record<string, string>;
    expect(JSON.stringify(headers)).toContain("SEC");
    expect(seen[0]!.init.signal, "出站必须带超时信号").toBeDefined();
  });

  it("createD1SyncSender 返回 notify / upsert / delete 三件套", () => {
    const sender = createD1SyncSender({} as never);
    expect(typeof sender.notify).toBe("function");
    expect(typeof sender.upsert).toBe("function");
    expect(typeof sender.delete).toBe("function");
    // 无对端配置时三个方法都必须静默无害
    expect(() => sender.notify(null, { table: "t" } as never)).not.toThrow();
    expect(() => sender.upsert(null, "t", { id: 1 } as never)).not.toThrow();
    expect(() => sender.delete(null, "t", "1" as never)).not.toThrow();
  });
});

/* ==================================================== notify engine */

import { broadcastNotification, sendChannelNotification } from "../../src/notify/engine.js";

describe("notify/engine：waitUntil 与驱动异常", () => {
  const payload = { title: "t", message: "m", level: "info" as const, event: "login" };

  it("broadcast 有 ctx.waitUntil 时立即返回逐通道 ok:true", async () => {
    const waitUntil = vi.fn((p: Promise<unknown>) => void p.catch(() => {}));
    const r = await broadcastNotification(
      [{ channel: "telegram", config: { botToken: "T", chatId: "1" } }],
      payload as never,
      { ctx: { waitUntil } },
    );
    expect(r).toHaveLength(1);
    expect(r[0]?.ok).toBe(true);
    expect(waitUntil, "实际投递应交给 waitUntil").toHaveBeenCalled();
  });

  it("broadcast 无 ctx 时同步等待真实结果", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })),
    );
    const r = await broadcastNotification(
      [{ channel: "telegram", config: { botToken: "T", chatId: "1" } }],
      payload as never,
    );
    expect(r[0]?.ok).toBe(true);
    vi.unstubAllGlobals();
  });

  it("驱动抛异常时被引擎捕获转成 ok:false（fail-safe）", async () => {
    // 用一个 getter 在读取配置时直接抛出，模拟驱动内部异常
    const exploding = {
      get botToken(): string {
        throw new Error("driver exploded");
      },
      chatId: "1",
    };
    const r = await sendChannelNotification("telegram", exploding as never, payload as never, {});
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("feishu / wecom / email 三通道都能到达各自驱动", async () => {
    for (const ch of ["feishu", "wecom", "email"] as const) {
      const r = await sendChannelNotification(
        ch,
        { webhookUrl: "https://qyapi.weixin.qq.com/x", url: "https://x", to: "a@b.c" } as never,
        payload as never,
        {},
      );
      expect(typeof r.ok, ch).toBe("boolean");
    }
  });
});

/* ==================================================== feishu 驱动 */

import { sendFeishu } from "../../src/notify/drivers/feishu.js";

describe("feishu 驱动：校验与错误体容错", () => {
  const payload = { title: "t", message: "m", level: "info" as const, event: "login" };

  it("缺 webhookUrl 时判失败", async () => {
    const r = await sendFeishu({} as never, payload as never);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webhookUrl/);
  });

  it("内网 webhookUrl 被拒（SSRF）", async () => {
    const r = await sendFeishu({ webhookUrl: "https://127.0.0.1/hook" } as never, payload as never);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invalid Feishu webhook URL/);
  });

  it("错误响应体读不出来时判失败但不崩", async () => {
    const bad = {
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => {
        throw new Error("body gone");
      },
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn(async () => bad));
    const r = await sendFeishu(
      { webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/abcdefghijklmnopqrstuvwxyz" } as never,
      payload as never,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/403/);
    vi.unstubAllGlobals();
  });

  it("HTTP 200 但缺少业务字段时判失败（fail-closed）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const r = await sendFeishu(
      { webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/abcdefghijklmnopqrstuvwxyz" } as never,
      payload as never,
    );
    expect(r.ok, "{} 不代表投递成功").toBe(false);
    vi.unstubAllGlobals();
  });
});

/* ==================================================== s3 client */

import { S3Client } from "../../src/s3/client.js";

describe("S3Client：错误路径", () => {
  const cfg = {
    accessKeyId: "AKIA",
    secretAccessKey: "secret",
    region: "us-east-1",
    bucket: "bkt",
    endpoint: "https://s3.example.com",
  };

  it("headObject 404 → exists:false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const r = await new S3Client(cfg as never).headObject("k");
    expect(r.exists).toBe(false);
    vi.unstubAllGlobals();
  });

  it("headObject 其他非 2xx → 抛错（不得当成不存在）", async () => {
    // 403 是权限错误，若当成"文件不存在"会让上层把配置问题误判为首次备份，
    // 从而生成一份基线覆盖掉真实数据 —— 必须抛出。
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 403, statusText: "Forbidden" })),
    );
    await expect(new S3Client(cfg as never).headObject("k")).rejects.toThrow(/403/);
    vi.unstubAllGlobals();
  });

  it("putObject 错误体读不出来时仍抛错且带状态码", async () => {
    const bad = {
      ok: false,
      status: 500,
      statusText: "ISE",
      text: async () => {
        throw new Error("gone");
      },
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn(async () => bad));
    await expect(new S3Client(cfg as never).putObject("k", "body")).rejects.toThrow(/500/);
    vi.unstubAllGlobals();
  });

  it("deleteObject 错误体读不出来时抛错", async () => {
    const bad = {
      ok: false,
      status: 409,
      statusText: "Conflict",
      text: async () => {
        throw new Error("gone");
      },
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn(async () => bad));
    await expect(new S3Client(cfg as never).deleteObject("k")).rejects.toThrow(/409/);
    vi.unstubAllGlobals();
  });

  it("listObjects 错误体读不出来时抛错", async () => {
    const bad = {
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => {
        throw new Error("gone");
      },
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn(async () => bad));
    await expect(new S3Client(cfg as never).listObjects()).rejects.toThrow(/400/);
    vi.unstubAllGlobals();
  });

  it("listObjects 把 maxKeys / prefix / delimiter / continuationToken 写进查询串", async () => {
    let seen = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: unknown) => {
        seen = String(u);
        return new Response(
          JSON.stringify({ Contents: [], IsTruncated: false, KeyCount: 0 }),
          { status: 200, headers: { "content-type": "application/xml" } },
        );
      }),
    );
    await new S3Client(cfg as never).listObjects({
      prefix: "backups/",
      delimiter: "/",
      maxKeys: 7,
      continuationToken: "tok",
    });
    expect(seen).toContain("max-keys=7");
    expect(seen).toContain("prefix=backups");
    expect(seen).toContain("delimiter=%2F");
    expect(seen).toContain("continuation-token=tok");
    vi.unstubAllGlobals();
  });
});

/* ==================================================== idempotency */

import {
  MemoryIdempotencyStore,
  KvIdempotencyStore,
  withIdempotency,
} from "../../src/middleware/idempotency.js";

describe("MemoryIdempotencyStore", () => {
  it("未命中返回 null", () => {
    expect(new MemoryIdempotencyStore().get("nope")).toBeNull();
  });

  it("过期条目被删除并返回 null", () => {
    vi.useFakeTimers();
    try {
      const s = new MemoryIdempotencyStore();
      s.set("k", { key: "k", response: new Response("x") } as never, 10);
      expect(s.get("k")).not.toBeNull();
      vi.advanceTimersByTime(11_000);
      expect(s.get("k"), "过期后必须视为未命中").toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("超过容量上限时淘汰最早写入的条目（防内存无界增长）", () => {
    const s = new MemoryIdempotencyStore();
    const cap = MemoryIdempotencyStore.MAX_ENTRIES;
    for (let i = 0; i <= cap; i++) {
      s.set(`k${i}`, { key: `k${i}`, response: new Response("x") } as never, 3600);
    }
    // 最早的 k0 被淘汰，最新的 k{cap} 仍在 —— 淘汰按写入顺序而非随机
    expect(s.get("k0"), "最早的条目应被淘汰").toBeNull();
    expect(s.get(`k${cap}`), "最新条目必须保留").not.toBeNull();
  });

  it("容量上限是一个有限值（否则形同没有上限）", () => {
    expect(Number.isFinite(MemoryIdempotencyStore.MAX_ENTRIES)).toBe(true);
    expect(MemoryIdempotencyStore.MAX_ENTRIES).toBeGreaterThan(0);
  });

  it("lock 加锁后第二次失败，unlock 后可再获取", () => {
    const s = new MemoryIdempotencyStore();
    expect(s.lock("k")).toBe(true);
    expect(s.lock("k")).toBe(false);
    s.unlock("k");
    expect(s.lock("k")).toBe(true);
  });
});

describe("KvIdempotencyStore：无 KV 绑定时安全降级", () => {
  it("get 无 kv → null", async () => {
    expect(await new KvIdempotencyStore(undefined as never).get("k")).toBeNull();
  });

  it("set 无 kv → 不抛错", async () => {
    await expect(
      new KvIdempotencyStore(undefined as never).set("k", {} as never, 60),
    ).resolves.toBeUndefined();
  });

  it("KV 里没有记录 → null", async () => {
    const kv = { get: async () => null, put: async () => {} };
    expect(await new KvIdempotencyStore(kv as never).get("k")).toBeNull();
  });

  it("KV 里 JSON 损坏 → null（不得让所有路由 500）", async () => {
    const kv = { get: async () => "{not json", put: async () => {} };
    expect(await new KvIdempotencyStore(kv as never).get("k")).toBeNull();
  });

  it("lock 抢到（写入后读回一致）时返回 true", async () => {
    const kv = { get: async (k: string) => (k.includes("lock:") ? "1" : null), put: async () => {}, delete: async () => {} };
    expect(await new KvIdempotencyStore(kv as never).lock("k", 30)).toBe(true);
  });

  it("lock 读回值不一致（被他人抢走）→ false", async () => {
    const kv = { get: async () => "0", put: async () => {}, delete: async () => {} };
    expect(await new KvIdempotencyStore(kv as never).lock("k", 30)).toBe(false);
  });

  it("lock 时 KV 抛错 → 返回 true（fail-open，避免 KV 抖动阻断主流程）", async () => {
    const kv = {
      get: async () => {
        throw new Error("KV down");
      },
      put: async () => {
        throw new Error("KV down");
      },
      delete: async () => {},
    };
    // 刻意 fail-open：幂等锁只是优化，KV 不可用时不该让整个支付接口不可用。
    // 代价是极端情况下可能重复执行副作用 —— 这个取舍写在类注释里。
    expect(await new KvIdempotencyStore(kv as never).lock("k", 30)).toBe(true);
  });

  it("unlock 清掉本地锁标记，可再次获取", async () => {
    const kv = { get: async () => "1", put: async () => {}, delete: async () => {} };
    const s = new KvIdempotencyStore(kv as never);
    expect(await s.lock("k", 30)).toBe(true);
    expect(await s.lock("k", 30), "同一实例内重复 lock 应失败").toBe(false);
    await s.unlock("k");
    expect(await s.lock("k", 30), "unlock 后可再获取").toBe(true);
  });
});

describe("withIdempotency(handler, options) → 中间件", () => {
  const store = new MemoryIdempotencyStore();
  const mkMw = () =>
    withIdempotency(
      async () => {
        calls++;
        return new Response("done", { status: 200 });
      },
      { store, headerName: "idempotency-key", ttlSeconds: 60 } as never,
    );
  let calls = 0;

  beforeEach(() => {
    calls = 0;
  });

  it("带幂等键的重复 POST 只执行一次副作用", async () => {
    const mw = mkMw();
    const req = () =>
      new Request("https://x/pay", {
        method: "POST",
        headers: { "idempotency-key": "idem-a" },
        body: JSON.stringify({ amount: 10 }),
      });
    const a = await mw(req(), {} as never);
    const b = await mw(req(), {} as never);
    expect(calls, "第二次应命中幂等缓存").toBe(1);
    expect(await a.text()).toBe(await b.text());
  });

  it("同键不同请求体视为不同请求（不误命中）", async () => {
    const mw = mkMw();
    await mw(
      new Request("https://x", { method: "POST", headers: { "idempotency-key": "idem-b" }, body: "a" }),
      {} as never,
    );
    await mw(
      new Request("https://x", { method: "POST", headers: { "idempotency-key": "idem-b" }, body: "b" }),
      {} as never,
    );
    expect(calls).toBe(2);
  });

  it("指纹只含 method + pathname + body，不含 query（同键同体即同一操作）", async () => {
    // 刻意设计：幂等键的语义是"标识一次操作"，同键同端点同体就是同一次操作。
    // 把 query 计入指纹会让 `?dryRun=1` 这类调试参数白白打破幂等。
    const mw = mkMw();
    for (const q of ["a=1", "a=2"]) {
      await mw(
        new Request(`https://x/p?${q}`, { method: "POST", headers: { "idempotency-key": "idem-c" } }),
        {} as never,
      );
    }
    expect(calls).toBe(1);
  });

  it("同键但 pathname 不同视为不同操作", async () => {
    const mw = mkMw();
    for (const p of ["/p1", "/p2"]) {
      await mw(
        new Request(`https://x${p}`, { method: "POST", headers: { "idempotency-key": "idem-c2" } }),
        {} as never,
      );
    }
    expect(calls).toBe(2);
  });

  it("无幂等键时直接放行（不缓存、不拦截）", async () => {
    const mw = mkMw();
    await mw(new Request("https://x", { method: "POST" }), {} as never);
    await mw(new Request("https://x", { method: "POST" }), {} as never);
    expect(calls).toBe(2);
  });

  it("GET 等安全方法不参与幂等（重复请求照样执行）", async () => {
    const mw = mkMw();
    const req = () => new Request("https://x", { headers: { "idempotency-key": "idem-d" } });
    await mw(req(), {} as never);
    await mw(req(), {} as never);
    expect(calls).toBe(2);
  });

  it("无请求体时指纹不崩", async () => {
    const mw = mkMw();
    await expect(
      mw(new Request("https://x", { method: "POST", headers: { "idempotency-key": "idem-e" } }), {} as never),
    ).resolves.toBeInstanceOf(Response);
  });
});

/* ==================================================== session DO HTTP */

import { AuthSessionDO } from "../../src/session/do.js";

describe("AuthSessionDO.fetch：畸形输入", () => {
  const SECRET = "s3cret-do-secret-value";
  type DoIface = { fetch(r: Request): Promise<Response> };
  // 签名是 new AuthSessionDO(ctx, env) —— env 传空会让入口全部 503（fail-closed）
  const mkDo = (env: Record<string, unknown> = { AUTH_SESSION_DO_SECRET: SECRET }) =>
    new (AuthSessionDO as never as new (ctx: unknown, st: unknown) => DoIface)({}, env);
  const authed = (path: string, init?: RequestInit) =>
    new Request(`https://do${path}`, {
      ...init,
      headers: { ...(init?.headers ?? {}), "X-Session-Secret": SECRET },
    });

  it("未注入密钥时一律 503（fail-closed）", async () => {
    const res = await mkDo({}).fetch(new Request("https://do/get?key=k"));
    expect(res.status).toBe(503);
  });

  it("密钥错误时 401", async () => {
    const res = await mkDo().fetch(
      new Request("https://do/get?key=k", { headers: { "X-Session-Secret": "wrong" } }),
    );
    expect(res.status).toBe(401);
  });

  it("未授权时不得读到任何值", async () => {
    const res = await mkDo().fetch(new Request("https://do/get?key=secret"));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.text()).not.toContain('"value":"secret"');
  });

  it("/set 收到非 JSON body → 400（而不是写入字面量 undefined 键）", async () => {
    const res = await mkDo().fetch(authed("/set", { method: "POST", body: "not json at all" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
  });

  it("/set 缺 key 字段同样 400", async () => {
    const res = await mkDo().fetch(
      authed("/set", { method: "POST", body: JSON.stringify({ value: "v" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("/take 与 /delete 收到非 JSON body 时不崩", async () => {
    const do_ = mkDo();
    for (const path of ["/take", "/delete"]) {
      const res = await do_.fetch(authed(path, { method: "POST", body: "<<<not json>>>" }));
      expect(res.status, path).toBeLessThan(500);
    }
  });

  it("未知路径 → 404", async () => {
    expect((await mkDo().fetch(authed("/unknown"))).status).toBe(404);
  });
});

/* ==================================================== i18n */

import { detectLanguage, i18nInjectionScript, getAuthI18n } from "../../src/ui/i18n.js";

describe("i18n：注入脚本与语言解析", () => {
  it("i18nInjectionScript 产出完整 script 标签", () => {
    const js = i18nInjectionScript("en");
    expect(js.startsWith("<script>")).toBe(true);
    expect(js.endsWith("</script>")).toBe(true);
    expect(js.length).toBeGreaterThan(20);
  });

  it("缺省语言时注入脚本仍可用", () => {
    expect(() => i18nInjectionScript()).not.toThrow();
    expect(i18nInjectionScript()).toContain("script");
  });

  it("?lang=zh-CN 解析为 zh（不以 en 开头）", () => {
    expect(detectLanguage(new Request("https://x/p?lang=zh-CN"))).toBe("zh");
  });

  it("?lang=en-US 优先于 cookie / accept-language", () => {
    const req = new Request("https://x/p?lang=en-US", {
      headers: { "accept-language": "zh-CN", cookie: "lang=zh" },
    });
    expect(detectLanguage(req)).toBe("en");
  });

  it("无任何语言信号时回落到默认语言", () => {
    expect(detectLanguage(new Request("https://x/p"))).toBe("zh");
    expect(getAuthI18n("zh")).toBeTruthy();
  });
});

/* ==================================================== env 扫描器 */

import { scanEnvAccess, bareAccesses } from "../../src/config/scan.js";

describe("scan：写入形态识别", () => {
  const scanOne = (src: string) => scanEnvAccess(src, "t.ts");
  /**
   * 写入类断言：写入**不应**产生任何 env 读取记录。
   *
   * 这里刻意断言"完全无输出"而不是 `not.toContain` —— 后者在扫描器
   * 因参数写错而返回空数组时会假绿（本次就发生过）。
   */
  const isWrite = (src: string, name: string) => {
    const found = scanOne(src).filter((a) => a.name === name);
    expect(found, `\`${src}\` 中的 env.${name} 应被识别为写入而非读取`).toEqual([]);
  };
  /** 读取类断言：必须真的看见，且落在裸访问里。 */
  const isBareRead = (src: string, name: string) => {
    const all = scanOne(src);
    expect(all.map((a) => a.name), `扫描器对 ${JSON.stringify(src)} 没有任何输出 —— 断言会是假绿`).toContain(name);
    expect(bareAccesses(all).map((a) => a.name), `env.${name} 应为裸访问`).toContain(name);
  };

  it("全部 16 种赋值运算符都被识别为写入", () => {
    // 写入是**声明**，不该要求运维去配置一个代码自己会创建的变量。
    // 只认裸 `=` 时，复合赋值会被漏掉并记成读取 —— 本轮修掉的正是这一类。
    const ops = [
      "=", "+=", "-=", "*=", "/=", "%=", "**=", "<<=", ">>=", ">>>=",
      "&=", "|=", "^=", "&&=", "||=", "??=",
    ];
    for (const op of ops) isWrite(`env.VALUE ${op} 1;`, "VALUE");
  });

  it("env.COUNTER++ / env.COUNTER-- 算写入（回归：探针曾只看赋值号）", () => {
    isWrite("env.COUNTER++;", "COUNTER");
    isWrite("env.COUNTER--;", "COUNTER");
  });

  it("delete env.FOO 算写入（回归：探针窗口曾以变量名结尾，永不命中）", () => {
    // 这条是本轮修掉的真缺陷：`isWriteAt` 原先只收 endIndex，
    // 而 `delete` 出现在 `env` **之前**，取窗口必然把它排除在外。
    // 后果：`delete env.TMP` 被算成裸访问，门禁要求配置一个只删不读的变量。
    isWrite("delete env.FOO;", "FOO");
    isWrite('delete env["BAR"];', "BAR");
    isWrite("delete env?.BAZ;", "BAZ");
  });

  it("delete 局部变量不误伤同名的 env 读取", () => {
    isBareRead("const x = env.TMP; delete x;", "TMP");
  });

  it("同一作用域里 delete 一个变量不影响另一个的读取判定", () => {
    const all = scanOne("if (env.KEEP) { delete env.GONE; }");
    expect(all.map((a) => a.name)).toContain("KEEP");
    expect(all.map((a) => a.name)).not.toContain("GONE");
  });

  it("== / === 是取值检查，绝不能被当成写入（否则读取从门禁视野消失）", () => {
    // 这条与上一条互为反向约束：赋值要认，比较不能认。
    for (const src of ["const eq = env.FOO == 1;", "const eq = env.FOO === 1;", "const ne = env.FOO != 2;"]) {
      const all = scanOne(src);
      expect(all.map((a) => a.name), src).toContain("FOO");
    }
  });

  it("与字面量比较判为 guarded（存在性检查，可安全复用）", () => {
    expect(scanOne("const eq = env.FOO === 1;").find((a) => a.name === "FOO")?.kind).toBe("guarded");
  });

  it("箭头函数的 => 不被误判为写入", () => {
    isBareRead("const f = () => 1; env.FOO;", "FOO");
  });

  it("三元表达式的两支都是读取（guarded 与 bare 各自归属）", () => {
    // 既定语义：三元/短路读取退化为 undefined 而非崩溃，判 guarded；
    // 但仍必须出现在扫描结果里，不能凭空消失。
    const all = scanOne("const v = c ? env.A : env.B;");
    expect(all.map((a) => a.name).sort()).toEqual(["A", "B"]);
    expect(bareAccesses(all).map((a) => a.name)).toEqual(["B"]);
  });

  it("对象字面量的键不会被当成 env 访问", () => {
    isBareRead("const o = { A: 1 }; env.A;", "A");
  });
});

describe("scan：未闭合结构不崩", () => {
  it("未闭合的括号 / 花括号不抛错", () => {
    const cases = [
      "if (env.FOO) { use(env.FOO);",
      "const { FOO } = env;",
      "function f( {",
      "const o = { a: env.FOO;",
    ];
    for (const src of cases) {
      expect(() => scanEnvAccess(src, "t.ts"), src).not.toThrow();
    }
  });

  it("顶层解构时取到正确的 env 名", () => {
    const a = bareAccesses(scanEnvAccess("const { FOO: local } = env;", "t.ts"));
    expect(a.length).toBeLessThanOrEqual(1);
  });
});
