/**
 * 新增代码的边界补齐
 *
 * 本文件针对本轮新增功能里**门禁点名**的未覆盖分支：
 *
 * - `ui/script-safety.ts` 的 CSP 状态机里 3 处"标签未闭合"兜底
 * - `s3/client.ts` 的 XML 实体解码与两处错误体读取失败
 * - `sync/sender.ts` 的异常序列化兜底与节点标识回落
 *
 * 共同点：都是"正常路径走不到、出错时才会触发"的分支。
 * 而这类分支恰恰最危险 —— 它们出错时代码已经处于异常状态，
 * 再抛一个异常就会把原始错误吞掉。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { applyCspNonce, cspNonceAttr, safeJsonForScript } from "../../src/ui/script-safety.js";
import { S3Client, uploadMultipartFromChunks } from "../../src/s3/client.js";
import { sendD1Change } from "../../src/sync/sender.js";
import type { SyncDeliveryResult } from "../../src/sync/types.js";

const CFG = {
  endpoint: "https://s3.example.com",
  bucket: "bkt",
  accessKeyId: "AKIA",
  secretAccessKey: "secret",
  region: "us-east-1",
};

/* ==================================================== CSP 状态机的兜底分支 */

describe("applyCspNonce：标签未闭合时的兜底", () => {
  const N = "NN";

  it("内容区里的普通标签未闭合 → 原样保留剩余内容", () => {
    // `<script>` 已开但整个输入在内容区结束，没有 `</script>`。
    // 此时若继续"找下一个标签"会一路扫到字符串末尾并插入一堆 nonce。
    const html = "<script>var a = '<div";
    const out = applyCspNonce(html, N);
    expect(out).toContain("var a = '<div");
    // 只应有**真实开标签**那一个 nonce；兜底不得再往伪标签上补
    expect((out.match(/nonce=/g) ?? []).length, "只允许真实开标签带 nonce").toBe(1);
  });

  it("内容区里遇到未闭合的伪标签 → 保留到输入结束", () => {
    const html = "<script>if (a < b) {} </scr";
    const out = applyCspNonce(html, N);
    expect(out).toContain("if (a < b) {}");
  });

  it("开标签的 `>` 缺失 → 原样保留，不猜测", () => {
    const html = '<div><script src="/x.js"';
    const out = applyCspNonce(html, N);
    // 猜测会把 nonce 补到不该补的位置，而截断本身说明模板有问题
    expect(out).toContain('<script src="/x.js"');
  });

  it("内容区结束标签缺少 `>` → 原样保留剩余内容", () => {
    const html = "<script>x()</script";
    const out = applyCspNonce(html, N);
    expect(out).toContain("x()");
  });

  it("非 script/style 的标签不补 nonce", () => {
    const out = applyCspNonce('<meta charset="utf-8"><div>x</div>', N);
    expect(out).not.toContain("nonce=");
  });

  it("空输入直接返回空串", () => {
    expect(applyCspNonce("", N)).toBe("");
  });

  it("cspNonceAttr 对各种空值都不输出属性", () => {
    expect(cspNonceAttr(undefined)).toBe("");
    expect(cspNonceAttr(null)).toBe("");
    expect(cspNonceAttr("")).toBe("");
    expect(cspNonceAttr("\t\n ")).toBe("");
  });

  it("safeJsonForScript 仍能正确转义（与 nonce 路径共存）", () => {
    const out = safeJsonForScript({ a: "</script>" });
    expect(out).not.toContain("</script>");
    const html = applyCspNonce(`<script>var B = ${out};</script>`, N);
    expect(html).toContain(`<script nonce="${N}">var B = ${out};</script>`);
  });
});

/* ==================================================== S3 客户端的兜底分支 */

describe("S3 客户端：错误路径兜底", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    warn.mockRestore();
  });

  it("complete 的错误体读不出来时仍抛错并带状态码", async () => {
    // 错误响应体读不出来时若连带崩掉，调用方拿到的会是
    // "TypeError: body already read" 而不是真正的 500 原因。
    const bad = {
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => {
        throw new Error("consumed");
      },
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn(async () => bad));
    await expect(
      new S3Client(CFG).completeMultipartUpload("k", "UP", [{ partNumber: 1, eTag: '"a"' }]),
    ).rejects.toThrow(/400/);
  });

  it("abort 的错误体读不出来时仍抛错", async () => {
    const bad = {
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => {
        throw new Error("consumed");
      },
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn(async () => bad));
    await expect(new S3Client(CFG).abortMultipartUpload("k", "UP")).rejects.toThrow(/403/);
  });

  it("XML 数字实体被解码（&#34; → \"）", async () => {
    // 某些网关会把 ETag 里的引号编码成数字实体；不解码就会把
    // "a" 原样带进 complete 清单，服务端回 400 MalformedXML
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("<Result><UploadId>UP&#34;1&#34;</UploadId></Result>", { status: 200 }),
      ),
    );
    const id = await new S3Client(CFG).createMultipartUpload("k");
    expect(id).toBe('UP"1"');
  });

  it("UploadId 为空标签时视为空串并报错", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<Result><UploadId/></Result>", { status: 200 })),
    );
    await expect(new S3Client(CFG).createMultipartUpload("k")).rejects.toThrow(/UploadId/);
  });

  it("headObject 缺 content-type 头时回落为 undefined（不留空串）", async () => {
    // 返回空串会让调用方的 `if (contentType)` 分支走到错误的一侧；
    // undefined 则明确表示"服务端没给"。
    // 不能用 Response 构造：`new Response("")` 总会带上
    // `content-type: text/plain;charset=UTF-8`，删不掉 —— 那样测的就不是
    // "服务端没给"这条路径了。
    const fakeHeaders = new Headers();
    fakeHeaders.set("content-length", "1");
    const fake = {
      ok: true,
      status: 200,
      headers: fakeHeaders,
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn(async () => fake));
    expect((await new S3Client(CFG).headObject("k")).contentType).toBeUndefined();
  });

  it("headObject 有 content-type 时原样带出", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("", {
            status: 200,
            headers: { "content-length": "1", "content-type": "application/json" },
          }),
      ),
    );
    expect((await new S3Client(CFG).headObject("k")).contentType).toBe("application/json");
  });

  it("非 Error 的分片失败原因也能被压成可读文本", async () => {
    // 分片失败原因会出现在抛出的错误里；上游若抛出字符串，
    // 直接 `e.message` 会得到 undefined，诊断信息就丢了。
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: unknown) => {
        if (String(u).includes("uploads=")) {
          return new Response("<UploadId>UP</UploadId>", { status: 200 });
        }
        throw "peer rejected the part";
      }),
    );
    await expect(
      uploadMultipartFromChunks(new S3Client(CFG), "k", new Uint8Array(10), {
        retriesPerPart: 0,
      }),
    ).rejects.toThrow(/peer rejected the part/);
  });
});

/* ==================================================== sync sender 的兜底分支 */

describe("sync sender：异常序列化与节点标识回落", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    warn.mockRestore();
  });

  it("抛出 0 / false / null 时仍产出可读原因", async () => {
    // `err?.message` 对这些值都是 undefined —— 若没有 String(err) 兜底，
    // 日志会变成 "reason=" 空着，等于什么都没记。
    for (const thrown of [0, false, null]) {
      const results: SyncDeliveryResult[] = [];
      let captured: Promise<unknown> | null = null;
      const customFetch = vi.fn(async () => {
        throw thrown;
      }) as unknown as typeof fetch;
      sendD1Change(
        { waitUntil: (p) => { captured = p; } },
        { PEER_SYNC_ENDPOINT: "https://p", PEER_SYNC_SECRET: "s" },
        { table: "t", action: "UPSERT", data: { id: 1 } },
        { customFetch, maxRetries: 0, retryBaseDelayMs: 0, retryJitter: 0, onResult: (r) => results.push(r) },
      );
      await captured;
      expect(typeof results[0]?.error, `thrown=${String(thrown)}`).toBe("string");
      expect(results[0]?.error?.length, `thrown=${String(thrown)}`).toBeGreaterThan(0);
    }
  });

  it("普通对象异常被 JSON 序列化", async () => {
    const results: SyncDeliveryResult[] = [];
    let captured: Promise<unknown> | null = null;
    const customFetch = vi.fn(async () => {
      throw { code: "ECONN", detail: "peer" };
    }) as unknown as typeof fetch;
    sendD1Change(
      { waitUntil: (p) => { captured = p; } },
      { PEER_SYNC_ENDPOINT: "https://p", PEER_SYNC_SECRET: "s" },
      { table: "t", action: "UPSERT", data: { id: 1 } },
      { customFetch, maxRetries: 0, retryBaseDelayMs: 0, retryJitter: 0, onResult: (r) => results.push(r) },
    );
    await captured;
    expect(results[0]?.error).toContain("ECONN");
  });

  it("event 未带 sourceNodeId 时回落到 config.nodeId", async () => {
    const seen: Array<Record<string, string>> = [];
    let captured: Promise<unknown> | null = null;
    const customFetch = vi.fn(async (_u: unknown, init?: RequestInit) => {
      seen.push((init?.headers ?? {}) as Record<string, string>);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    sendD1Change(
      { waitUntil: (p) => { captured = p; } },
      { PEER_SYNC_ENDPOINT: "https://p", PEER_SYNC_SECRET: "s" },
      { table: "t", action: "UPSERT", data: { id: 1 } },
      { customFetch, nodeId: "cfg-node" },
    );
    await captured;
    expect(seen[0]?.["X-Sync-Origin-Node"]).toBe("cfg-node");
  });

  it("event 显式带 sourceNodeId 时优先", async () => {
    const seen: Array<Record<string, string>> = [];
    let captured: Promise<unknown> | null = null;
    const customFetch = vi.fn(async (_u: unknown, init?: RequestInit) => {
      seen.push((init?.headers ?? {}) as Record<string, string>);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    sendD1Change(
      { waitUntil: (p) => { captured = p; } },
      { PEER_SYNC_ENDPOINT: "https://p", PEER_SYNC_SECRET: "s" },
      { table: "t", action: "UPSERT", data: { id: 1 }, sourceNodeId: "explicit" },
      { customFetch, nodeId: "cfg-node" },
    );
    await captured;
    expect(seen[0]?.["X-Sync-Origin-Node"]).toBe("explicit");
  });
});
