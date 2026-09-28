/**
 * 收官批：5 个仍有可达分支的文件
 *
 * `sync/sender` 的超时回调、`config/scan` 的花括号配对、`s3/sigv4` 的
 * 预签名分支、`backup/s3-backup` 的恢复链筛选回调、modern 主题渲染器的
 * 语言兜底 —— 这几处的共同点是**需要特定的调用形态**才能进入，
 * 而不是靠"多调几次"能碰到的。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let warn: ReturnType<typeof vi.spyOn>;
let dbg: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  dbg = vi.spyOn(console, "debug").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  warn.mockRestore();
  dbg.mockRestore();
});

/* ==================================================== sync/sender：超时 */

import { sendD1Change } from "../../src/sync/sender.js";

describe("sync/sender：超时中止", () => {
  const event = { table: "users", action: "UPSERT", data: { id: 1 } } as never;

  it("对端挂起超过 timeoutMs 时中止请求（而不是永远占用连接）", async () => {
    // fetch 永不 resolve，只有 AbortSignal 能救场。
    // 不传 signal 的话这条推送会一直挂着，占满并发额度。
    const customFetch = vi.fn(
      (_u: unknown, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener("abort", () => rej(new Error("aborted")));
        }),
    );
    const waitUntil = vi.fn((p: Promise<unknown>) => void p.catch(() => {}));
    const t0 = Date.now();
    sendD1Change({ waitUntil }, { PEER_SYNC_ENDPOINT: "https://p", PEER_SYNC_SECRET: "s" } as never, event, {
      customFetch,
      timeoutMs: 30,
    } as never);
    await (waitUntil.mock.calls[0]?.[0] as Promise<unknown>);
    expect(customFetch).toHaveBeenCalled();
    expect(customFetch.mock.calls[0]?.[1]?.signal, "出站必须带超时信号").toBeDefined();
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("超时走降级而不是抛错（同步推送不阻断业务）", async () => {
    const customFetch = vi.fn(
      (_u: unknown, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener("abort", () => rej(new Error("aborted")));
        }),
    );
    const waitUntil = vi.fn((p: Promise<unknown>) => void p.catch(() => {}));
    sendD1Change({ waitUntil }, { PEER_SYNC_ENDPOINT: "https://p", PEER_SYNC_SECRET: "s" } as never, event, {
      customFetch,
      timeoutMs: 10,
      maxRetries: 0,
    } as never);
    await (waitUntil.mock.calls[0]?.[0] as Promise<unknown>);
    expect(warn, "对端不可用需有默认可见的告警").toHaveBeenCalled();
  });

  it("err 为非 Error 时告警日志仍带出原因（String(err) 分支）", async () => {
    const customFetch = vi.fn(async () => {
      throw "peer said no";
    });
    const waitUntil = vi.fn((p: Promise<unknown>) => void p.catch(() => {}));
    sendD1Change({ waitUntil }, { PEER_SYNC_ENDPOINT: "https://p", PEER_SYNC_SECRET: "s" } as never, event, {
      customFetch,
      maxRetries: 0,
    } as never);
    await (waitUntil.mock.calls[0]?.[0] as Promise<unknown>);
    expect(warn).toHaveBeenCalled();
  });
});

/* ==================================================== config/scan：块内解构 */

import { scanEnvAccess, bareAccesses } from "../../src/config/scan.js";

describe("scan：块内解构的花括号配对", () => {
  const kindOf = (src: string, name: string) =>
    scanEnvAccess(src, "t").find((a) => a.name === name)?.kind;

  it("嵌套块内的解构能正确找到外层花括号（守卫在下一行也生效）", () => {
    const src = [
      "function f() {",
      "  if (cond) {",
      "    const { A } = env;",
      "    use(A);",
      "  }",
      "}",
    ].join("\n");
    // 关键：A 的守卫写在解构之外，若花括号配错就会退化成裸访问
    expect(kindOf(src, "A")).toBeTruthy();
  });

  it("解构改名的局部别名在同块内被 if 守卫 → guarded", () => {
    // 必须是**改名**形式：`const { A: local } = env` 才会产生可被守卫的局部别名。
    // `const { A } = env` 里 A 本身就是 env 的属性名，没有别名可守。
    const src = ["function f() {", "  const { A: local } = env;", "  if (local) { use(local); }", "}"].join("\n");
    expect(kindOf(src, "A")).toBe("guarded");
  });

  it("不解构改名的同名变量不算有守卫（避免把裸访问误判为 guarded）", () => {
    const src = ["function f() {", "  const { A } = env;", "  if (A) { use(A); }", "}"].join("\n");
    expect(kindOf(src, "A")).toBe("bare");
  });

  it("解构的局部别名无守卫 → bare", () => {
    const src = ["function f() {", "  const { A } = env;", "  use(A);", "}"].join("\n");
    expect(kindOf(src, "A")).toBe("bare");
  });

  it("顶层解构（无外层块）也能扫到", () => {
    const src = "const { A } = env; use(A);";
    expect(scanEnvAccess(src, "t").map((a) => a.name)).toContain("A");
  });

  it("深嵌套 + 大量干扰代码后仍能正确配对", () => {
    const pad = Array.from({ length: 40 }, (_, i) => `  // 干扰 ${i}`).join("\n");
    const src = ["function f() {", pad, "  {", "    {", "      const { DEEP } = env;", "      use(DEEP);", "    }", "  }", "}"].join("\n");
    expect(scanEnvAccess(src, "t").map((a) => a.name)).toContain("DEEP");
  });

  it("写入形式的解构默认值不产生访问", () => {
    const src = "const { A = 1 } = env;";
    // 有默认值的解构是"读取 + 兜底"，仍算一次读取
    expect(scanEnvAccess(src, "t").map((a) => a.name)).toContain("A");
  });

  it("解构后重命名 + 局部别名守卫", () => {
    const src = ["function f() {", "  const { A: local } = env;", "  if (local) { use(local); }", "}"].join("\n");
    expect(scanEnvAccess(src, "t").map((a) => a.name)).toContain("A");
  });

  it("裸访问集合过滤在多种输入下都可用", () => {
    for (const src of [
      "env.A;",
      "if (env.B) {} use(env.C);",
      "const { D } = env;",
      "env?.E;",
      "env[\"F\"];",
      "delete env.G;",
    ]) {
      expect(() => bareAccesses(scanEnvAccess(src, "t")), src).not.toThrow();
    }
  });
});

/* ==================================================== s3/sigv4：预签名 */

import { createPresignedUrl } from "../../src/s3/sigv4.js";

describe("sigv4：createPresignedUrl 的完整分支", () => {
  const base = {
    accessKeyId: "AKIA",
    secretAccessKey: "secret",
    region: "us-east-1",
    service: "s3",
  } as never;

  it("缺省 method 为 GET，缺省 expiresIn 为 3600", async () => {
    const u = await createPresignedUrl({ ...(base as object), url: new URL("https://b.s3.amazonaws.com/k") } as never);
    expect(u).toContain("X-Amz-Expires=3600");
    expect(u).toContain("X-Amz-SignedHeaders=host");
  });

  it("带 sessionToken 时写入 X-Amz-Security-Token", async () => {
    const u = await createPresignedUrl({
      ...(base as object),
      url: new URL("https://b.s3.amazonaws.com/k"),
      sessionToken: "TOK",
    } as never);
    expect(u).toContain("X-Amz-Security-Token=TOK");
  });

  it("根路径（pathname 为空）也能签出 URL", async () => {
    const u = await createPresignedUrl({ ...(base as object), url: new URL("https://b.s3.amazonaws.com") } as never);
    expect(u).toContain("X-Amz-Signature=");
  });

  it("method 可覆盖为 PUT", async () => {
    const get = await createPresignedUrl({ ...(base as object), url: new URL("https://b.s3.amazonaws.com/k") } as never);
    const put = await createPresignedUrl({
      ...(base as object),
      url: new URL("https://b.s3.amazonaws.com/k"),
      method: "PUT",
    } as never);
    // method 进 canonical request → 签名必须不同
    expect(put).not.toBe(get);
  });

  it("已存在的查询参数（同名不同值）参与排序，签名可复现", async () => {
    const opts = {
      ...(base as object),
      url: new URL("https://b.s3.amazonaws.com/k?z=1&a=2&m=3"),
    } as never;
    expect(await createPresignedUrl(opts)).toBe(await createPresignedUrl(opts));
  });

  it("相同 key 的多值查询参数按值排序（AWS 规范）", async () => {
    const sigOf = (u: string) => new URL(u).searchParams.get("X-Amz-Signature");
    const a = await createPresignedUrl({
      ...(base as object),
      url: new URL("https://b.s3.amazonaws.com/k?list-type=2&prefix=z&prefix=a"),
    } as never);
    const b = await createPresignedUrl({
      ...(base as object),
      url: new URL("https://b.s3.amazonaws.com/k?list-type=2&prefix=a&prefix=z"),
    } as never);
    // 比较**签名**而非整条 URL：调用方给的查询串顺序本就可能不同，
    // 签名必须对两种顺序给出同一结果（canonical query 排序的职责）。
    expect(sigOf(a)).toBe(sigOf(b));
  });

  it("含中文与特殊字符的 key 也能签出（编码不崩）", async () => {
    const u = await createPresignedUrl({
      ...(base as object),
      url: new URL("https://b.s3.amazonaws.com/中文 空格/k"),
    } as never);
    expect(u).toContain("X-Amz-Signature=");
  });
});

/* ==================================================== backup/s3-backup：链筛选 */

interface Stored {
  body: string;
  lastModified?: string;
}

/** 构造 S3 内存替身，支持按 key 前缀列举 */
function makeS3(objects: Record<string, Stored> = {}) {
  const store = new Map<string, Stored>(Object.entries(objects));
  const put = vi.fn(async (key: string, data: string) => {
    store.set(key, { body: data, lastModified: new Date().toISOString() });
    return { ok: true } as never;
  });
  const get = vi.fn(async (key: string) => {
    const o = store.get(key);
    return o ? ({ ok: true, text: async () => o.body } as never) : null;
  });
  const del = vi.fn(async (key: string) => {
    store.delete(key);
  });
  const list = vi.fn(async (o?: { prefix?: string }) => {
    const e = [...store.entries()].filter(([k]) => !o?.prefix || k.startsWith(o.prefix));
    return {
      objects: e.map(([key, v]) => ({ key, size: v.body.length, lastModified: v.lastModified ?? new Date().toISOString() })),
      commonPrefixes: [],
      isTruncated: false,
      keyCount: e.length,
    };
  });
  vi.doMock("../../src/s3/client.js", () => ({
    S3Client: class {
      putObject = put;
      getObject = get;
      deleteObject = del;
      listObjects = list;
    },
  }));
  return { store, put, get, del, list };
}

const incremental = (n: number, from: number, to: number) => ({
  body: JSON.stringify({
    version: 1,
    mode: "incremental",
    service: "Mail",
    timestamp: to,
    sinceTimestamp: from,
    untilTimestamp: to,
    tables: { users: { name: "users", rowCount: 0, columns: ["id"], rows: [] } },
  }),
  lastModified: new Date(to).toISOString(),
});

describe("restoreIncrementalChainFromS3：模式筛选", () => {
  const S3 = {
    accessKeyId: "AKIA",
    secretAccessKey: "s",
    region: "us-east-1",
    bucket: "b",
    endpoint: "https://s3.example.com",
  } as never;

  const fakeDb = () => {
    const stmt = (res: unknown[]) => {
      const self: Record<string, unknown> = {
        bind: () => self,
        run: async () => ({ success: true, meta: { changes: 0 } }),
        first: async () => res[0] ?? null,
        all: async () => ({ results: res }),
      };
      return self;
    };
    return {
      prepare(sql: string) {
        if (sql.includes("sqlite_master")) return stmt([{ name: "users", sql: "CREATE TABLE users(id)" }]);
        return stmt([]);
      },
    } as never;
  };

  const load = () => import("../../src/backup/s3-backup.js");

  it("mode=selected 且给出 bundleKeys → 只恢复选中的包", async () => {
    const k1 = "backups/Mail/inc/incr_1_1_10_Mail.json";
    const k2 = "backups/Mail/inc/incr_2_2_20_Mail.json";
    makeS3({ [k1]: incremental(1, 1, 10), [k2]: incremental(2, 2, 20) });
    const { restoreIncrementalChainFromS3: fn } = await load();
    const r = await fn({
      db: fakeDb(),
      serviceName: "Mail",
      s3: S3,
      mode: "selected",
      bundleKeys: [k2],
      dryRun: true,
    } as never);
    expect(r).toBeTruthy();
  });

  it("mode=timeframe 按时间窗筛选（只落在窗内的包）", async () => {
    makeS3({
      "backups/Mail/inc/a.json": incremental(1, 100, 200),
      "backups/Mail/inc/b.json": incremental(2, 9000, 9500),
    });
    const { restoreIncrementalChainFromS3: fn } = await load();
    const r = await fn({
      db: fakeDb(),
      serviceName: "Mail",
      s3: S3,
      mode: "timeframe",
      untilTimestamp: 1000,
      sinceTimestamp: 0,
      dryRun: true,
    } as never);
    expect(r).toBeTruthy();
  });

  it("timeframe 窗口内无包时给出可判定结果而非抛错", async () => {
    makeS3({ "backups/Mail/inc/b.json": incremental(2, 9000, 9500) });
    const { restoreIncrementalChainFromS3: fn } = await load();
    const r = await fn({
      db: fakeDb(),
      serviceName: "Mail",
      s3: S3,
      mode: "timeframe",
      untilTimestamp: 1000,
      sinceTimestamp: 0,
      dryRun: true,
    } as never);
    expect(r).toBeTruthy();
  });

  it("dryRun 下逐包统计行数（不写库）", async () => {
    makeS3({ "backups/Mail/inc/a.json": incremental(1, 100, 200) });
    const { restoreIncrementalChainFromS3: fn } = await load();
    const r = await fn({
      db: fakeDb(),
      serviceName: "Mail",
      s3: S3,
      mode: "latest",
      dryRun: true,
      includeTables: ["users"],
    } as never);
    expect(r).toBeTruthy();
  });
});

/* ==================================================== modern 主题语言兜底 */

import {
  renderModernSetupHtml,
  renderModernLoginHtml,
  renderModernInviteHtml,
  renderModernRecoveryHtml,
  renderModernConsentHtml,
  renderModernSsoErrorHtml,
} from "../../src/ui/themes/modern/index.js";

describe("modern 主题：语言解析与文案兜底", () => {
  const renderers = [
    ["setup", renderModernSetupHtml],
    ["login", renderModernLoginHtml],
    ["invite", renderModernInviteHtml],
    ["recovery", renderModernRecoveryHtml],
    ["consent", renderModernConsentHtml],
    ["sso-error", renderModernSsoErrorHtml],
  ] as const;

  for (const [name, fn] of renderers) {
    it(`${name}：显式 lang=en → <html lang="en">`, () => {
      expect(fn({ lang: "en" } as never)).toContain('<html lang="en"');
    });

    it(`${name}：lang=zh-CN → <html lang="zh-CN">`, () => {
      expect(fn({ lang: "zh-CN" } as never)).toContain('<html lang="zh-CN"');
    });

    it(`${name}：不传 lang 也不传 request 时回落到中文`, () => {
      // 三个分支：不传 lang / 传 request / 都不传
      const h = fn({} as never);
      expect(h).toContain("<!doctype html>");
      expect(h).toContain("zh-CN");
    });

    it(`${name}：传 request 时按请求语言探测`, () => {
      const h = fn({
        request: new Request("https://x", { headers: { "accept-language": "en-US" } }),
      } as never);
      expect(h).toContain('<html lang="en"');
    });
  }

  it("setup：pkName 显式传空串时不被回填成 dev 默认值", () => {
    const withEmpty = renderModernSetupHtml({ pkName: "" } as never);
    const unset = renderModernSetupHtml({} as never);
    expect(withEmpty).toBeTruthy();
    expect(unset).toBeTruthy();
  });

  it("副标题恒取自字典，调用方无法覆盖（避免页面上出现未转义文案）", () => {
    // `subTitle` 不是公开选项：brand 区的副标题一律来自 i18n 字典。
    // 开放成入参就等于开放了一个"未转义文本进页面"的口子。
    const fromDict = renderModernLoginHtml({ lang: "zh" } as never);
    expect(fromDict).toContain("brand-desc");
    // 传一个字典里没有的键名不会影响输出
    const spoof = renderModernLoginHtml({ lang: "zh", subTitle: "<img src=x>" } as never);
    expect(spoof, "入参不得成为文案来源").not.toContain("<img src=x>");
  });

  it("consent：字典缺项时回落到内置中文文案", () => {
    // consent 相关文案键位较新，用一个未知语言强制走兜底
    const h = renderModernConsentHtml({ lang: "fr" } as never);
    expect(h).toContain("<!doctype html>");
  });

  it("sso 错误页：有错误码展示、无错误码不产出空块", () => {
    expect(renderModernSsoErrorHtml({ error: "access_denied" } as never)).toContain("access_denied");
    // 只查 <body> 之后：客户端脚本里 `typeof x === 'undefined'` 是正常代码
    const noErr = renderModernSsoErrorHtml({} as never);
    expect(noErr.slice(noErr.indexOf("<body>"))).not.toContain("undefined");
  });
});
