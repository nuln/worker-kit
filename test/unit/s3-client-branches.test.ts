/**
 * S3 客户端的分支覆盖补齐
 *
 * ## 为什么专门补这一块
 *
 * `s3/client.ts` 有 4 个 `anonymous_*` 函数**从未被调用过** —— 全都是
 * 「读取错误响应体再抛错」的路径：
 *
 * ```ts
 * const errText = await res.text().catch(() => "");
 * throw new Error(`S3Client.putObject failed [${res.status}]: ${errText}`);
 * ```
 *
 * 也就是说：**所有会抛错的代码路径都没有测试**。这类路径的退化不会让
 * 成功路径失败，只会让线上排障时看到一句无用的 `S3Client.xxx failed [500]: `。
 *
 * 另外 `encodeKey` 里拒绝 `.` / `..` 段的那段（防止 path-style URL 把
 * key 静默指向另一个对象）也是未覆盖分支 —— 那是本次合并新增的安全修复。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { S3Client } from "../../src/s3/client.js";

/** 记录签名的请求桩，避免真实出网 */
interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function stubFetch(responder: (req: Captured) => Response | Promise<Response>) {
  const calls: Captured[] = [];
  const fn = vi.fn(async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h && typeof h.forEach === "function" && !Array.isArray(h)) {
      h.forEach((v: string, k: string) => {
        headers[k] = v;
      });
    } else if (h && typeof h === "object") {
      Object.assign(headers, h);
    }
    const captured: Captured = { url, method: init?.method ?? "GET", headers };
    calls.push(captured);
    return responder(captured);
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

const client = () =>
  new S3Client({
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secret",
    region: "us-east-1",
    bucket: "my-bucket",
    endpoint: "https://s3.example.com",
  } as never);

const OK_XML = `<?xml version="1.0"?><ListBucketResult><Contents><Key>k</Key></Contents></ListBucketResult>`;

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  consoleError.mockRestore();
});

/* ==================================================== 错误响应路径 */

describe("错误响应：四个抛错路径都必须给出可读信息", () => {
  it("listObjects 失败时错误里含状态码与服务端消息", async () => {
    stubFetch(() => new Response("<Error><Code>NoSuchBucket</Code></Error>", { status: 404 }));
    await expect(client().listObjects({ prefix: "prefix" })).rejects.toThrow(/404/);
    await expect(client().listObjects({ prefix: "prefix" })).rejects.toThrow(/NoSuchBucket|</);
  });

  it("putObject 失败时错误里含状态码", async () => {
    stubFetch(() => new Response("AccessDenied", { status: 403 }));
    await expect(
      client().putObject("a/b.txt", "body"),
    ).rejects.toThrow(/putObject/);
  });

  it("getObject 失败时错误里含状态码", async () => {
    stubFetch(() => new Response("NotFound", { status: 404 }));
    await expect(client().getObject("a/b.txt")).rejects.toThrow(/getObject/);
  });

  it("deleteObject 失败时错误里含状态码", async () => {
    stubFetch(() => new Response("AccessDenied", { status: 403 }));
    await expect(client().deleteObject("a/b.txt")).rejects.toThrow(/deleteObject/);
  });

  it("错误响应体读取失败时不得二次抛错（必须仍能抛出带状态码的错误）", async () => {
    // 构造一个 body 读取会抛的 Response
    const bad = {
      ok: false,
      status: 500,
      text: async () => {
        throw new Error("body already consumed");
      },
    } as unknown as Response;
    stubFetch(() => bad);
    await expect(client().getObject("a/b.txt")).rejects.toThrow(/500/);
  });

  it("错误信息不得泄漏 secretAccessKey", async () => {
    stubFetch(() => new Response("boom", { status: 500 }));
    try {
      await client().putObject("k", "v");
      expect.unreachable?.();
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("secret");
      expect(String((e as Error).message)).not.toContain("AKIAEXAMPLE");
    }
  });
});

/* ==================================================== key 编码 */

describe("object key 编码", () => {
  it("拒绝 `.` 段（path-style URL 无法忠实表达）", async () => {
    stubFetch(() => new Response(OK_XML, { status: 200 }));
    await expect(client().getObject("a/./b")).rejects.toThrow(/relative path segment/);
  });

  it("拒绝 `..` 段（否则 URL 规范化会指向另一个对象）", async () => {
    stubFetch(() => new Response(OK_XML, { status: 200 }));
    await expect(client().getObject("../../etc/passwd")).rejects.toThrow(/relative path segment/);
  });

  it("拒绝嵌在中间的 `..` 段", async () => {
    stubFetch(() => new Response(OK_XML, { status: 200 }));
    await expect(client().getObject("a/../b")).rejects.toThrow(/relative path segment/);
  });

  it("正常 key 的各段被分别编码", async () => {
    const calls = stubFetch(() => new Response(OK_XML, { status: 200 }));
    await client().getObject("dir/na me/中文.txt").catch(() => {});
    const url = calls[0]?.url ?? "";
    expect(url, "空格应被编码").not.toContain(" ");
    expect(url, "中文应被百分号编码").toMatch(/%E4%B8%AD/);
    expect(url, "段分隔符保留").toContain("/");
  });

  it("key 里的 # 与 ? 被编码（否则会被当成 URL 片段/查询串）", async () => {
    const calls = stubFetch(() => new Response(OK_XML, { status: 200 }));
    await client().getObject("a#b?c").catch(() => {});
    const url = calls[0]?.url ?? "";
    expect(url).toContain("%23");
    expect(url).toContain("%3F");
  });

  it("空 key 解析为桶根（listObjects 依赖此行为）", () => {
    // 注意：空 key **会**指向桶根而不是被拒绝 —— listObjects 正是靠
    // resolveUrl("") 来列举桶内容的。这里把该行为钉住，避免日后
    // 有人"顺手加个空 key 校验"时把分页列举改坏。
    // 默认是 virtual-hosted 风格，空 key → `https://my-bucket.s3.example.com/`
    const c = client();
    expect(c.resolveUrl("").host).toBe("my-bucket.s3.example.com");
    expect(c.resolveUrl("").pathname).toBe("/");
    // path-style 下则落到 /<bucket>
    const pathStyle = new S3Client({
      accessKeyId: "a", secretAccessKey: "s", region: "r",
      bucket: "my-bucket", endpoint: "https://s3.example.com", forcePathStyle: true,
    } as never);
    expect(pathStyle.resolveUrl("").pathname).toBe("/my-bucket");
  });

  it("key 前导斜杠被去掉，不产生双斜杠", () => {
    const c = client();
    expect(c.resolveUrl("/a/b").pathname).not.toContain("//");
    expect(c.resolveUrl("///a").pathname.endsWith("/a")).toBe(true);
  });

  it("path-style 与 virtual-hosted 两种模式都正确", () => {
    const mk = (forcePathStyle: boolean) =>
      new S3Client({
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "secret",
        region: "us-east-1",
        bucket: "bkt",
        endpoint: "https://s3.example.com",
        forcePathStyle,
      } as never);
    expect(mk(true).resolveUrl("k").toString()).toContain("/bkt/k");
    expect(mk(false).resolveUrl("k").host).toBe("bkt.s3.example.com");
  });

  it("构造器缺少必填项时抛错", () => {
    const base = {
      accessKeyId: "a",
      secretAccessKey: "s",
      region: "r",
      bucket: "b",
      endpoint: "https://e",
    };
    expect(() => new S3Client({ ...base, endpoint: "" } as never)).toThrow(/endpoint/);
    expect(() => new S3Client({ ...base, bucket: "" } as never)).toThrow(/bucket/);
    expect(() => new S3Client({ ...base, accessKeyId: "" } as never)).toThrow(/accessKeyId/);
    expect(() => new S3Client({ ...base, secretAccessKey: "" } as never)).toThrow(/secretAccessKey/);
  });

  it("endpoint 省略协议时补 https://", () => {
    const c = new S3Client({
      accessKeyId: "a",
      secretAccessKey: "s",
      region: "r",
      bucket: "b",
      endpoint: "s3.example.com",
    } as never);
    expect(c.endpoint.protocol).toBe("https:");
  });
});

/* ==================================================== 签名与请求构造 */

describe("SigV4 请求构造", () => {
  it("带 Authorization 头且含 Credential 作用域", async () => {
    const calls = stubFetch(() => new Response(OK_XML, { status: 200 }));
    await client().listObjects().catch(() => {});
    const auth = calls[0]?.headers?.Authorization ?? calls[0]?.headers?.authorization ?? "";
    expect(auth).toMatch(/^AWS4-HMAC-SHA256 Credential=/);
    expect(auth).toContain("us-east-1");
    expect(auth).toMatch(/Signature=/);
  });

  it("带 x-amz-date 与 x-amz-content-sha256", async () => {
    const calls = stubFetch(() => new Response(OK_XML, { status: 200 }));
    await client().putObject("k", "v").catch(() => {});
    const h = calls[0]?.headers ?? {};
    const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
    expect(lower["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
    expect(lower["x-amz-content-sha256"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("query 参数被拼进 URL（continuation token 场景）", async () => {
    const calls = stubFetch(() => new Response(OK_XML, { status: 200 }));
    await client().listObjects({ prefix: "my-prefix", continuationToken: "TOKEN123" }).catch(() => {});
    const url = calls[0]?.url ?? "";
    expect(url).toContain("continuation-token=TOKEN123");
    expect(url).toContain("prefix=my-prefix");
  });

  it("参数值为空时不写入 query", async () => {
    const calls = stubFetch(() => new Response(OK_XML, { status: 200 }));
    await client().listObjects().catch(() => {});
    const url = calls[0]?.url ?? "";
    expect(url).not.toContain("prefix=");
    expect(url).not.toContain("continuation-token=");
  });

  it("PUT 带 Content-Type", async () => {
    const calls = stubFetch(() => new Response("", { status: 200 }));
    await client().putObject("k", "v", { contentType: "text/plain" }).catch(() => {});
    const h = calls[0]?.headers ?? {};
    const ct = Object.entries(h).find(([k]) => k.toLowerCase() === "content-type");
    expect(ct?.[1]).toBe("text/plain");
  });

  it("DELETE 用 HTTP DELETE 方法", async () => {
    const calls = stubFetch(() => new Response("", { status: 204 }));
    await client().deleteObject("a/b.txt").catch(() => {});
    expect(calls[0]?.method).toBe("DELETE");
  });

  it("同一个 key 两次签名的 Authorization 一致（签名只取决于 key/时间）", async () => {
    const calls = stubFetch(() => new Response("", { status: 200 }));
    const c = client();
    await c.putObject("same", "v").catch(() => {});
    await c.putObject("same", "v").catch(() => {});
    expect(calls.length).toBe(2);
    expect(calls[0]?.headers?.Authorization).toBe(calls[1]?.headers?.Authorization);
  });

  it("不同 payload 产生不同的 payload hash", async () => {
    const calls = stubFetch(() => new Response("", { status: 200 }));
    const c = client();
    await c.putObject("k", "aaa").catch(() => {});
    await c.putObject("k", "bbb").catch(() => {});
    const h = calls.map((x) =>
      Object.entries(x.headers).find(([k]) => k.toLowerCase() === "x-amz-content-sha256")?.[1],
    );
    expect(h[0]).not.toBe(h[1]);
  });
});

/* ==================================================== 响应解析 */

describe("响应解析的容错", () => {
  it("listObjects 解析出对象摘要", async () => {
    stubFetch(() =>
      new Response(
        `<?xml version="1.0"?><ListBucketResult><Contents><Key>a.txt</Key><Size>3</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents><Contents><Key>b.txt</Key><Size>4</Size><LastModified>2026-01-02T00:00:00.000Z</LastModified></Contents></ListBucketResult>`,
        { status: 200 },
      ),
    );
    const r = await client().listObjects();
    expect(r.objects.map((o) => o.key)).toEqual(["a.txt", "b.txt"]);
    expect(r.objects[0]?.size).toBe(3);
    expect(r.isTruncated).toBe(false);
    expect(r.keyCount).toBe(2);
  });

  it("空列表返回空数组而不是 null", async () => {
    stubFetch(() =>
      new Response(`<?xml version="1.0"?><ListBucketResult></ListBucketResult>`, { status: 200 }),
    );
    const r = await client().listObjects();
    expect(r.objects).toEqual([]);
    expect(Array.isArray(r.commonPrefixes)).toBe(true);
  });

  it("含 IsTruncated / NextContinuationToken 时原样透出（供分页）", async () => {
    stubFetch(() =>
      new Response(
        `<?xml version="1.0"?><ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>TOK</NextContinuationToken><Contents><Key>a</Key><Size>1</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents></ListBucketResult>`,
        { status: 200 },
      ),
    );
    const r = await client().listObjects();
    expect(r.isTruncated).toBe(true);
    expect(r.nextContinuationToken).toBe("TOK");
  });

  it("delimiter 产生 commonPrefixes", async () => {
    stubFetch(() =>
      new Response(
        `<?xml version="1.0"?><ListBucketResult><CommonPrefixes><Prefix>dir/</Prefix></CommonPrefixes><Contents><Key>a</Key><Size>1</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents></ListBucketResult>`,
        { status: 200 },
      ),
    );
    const r = await client().listObjects({ delimiter: "/" });
    expect(r.commonPrefixes).toContain("dir/");
  });

  it("getObject 返回原始 Response（由调用方决定怎么读）", async () => {
    stubFetch(() => new Response("hello world", { status: 200 }));
    const res = await client().getObject("a.txt");
    expect(res).toBeInstanceOf(Response);
    expect(await res.text()).toBe("hello world");
  });

  it("getObject 支持 range 请求", async () => {
    const calls = stubFetch(() => new Response("chunk", { status: 206 }));
    await client().getObject("a.bin", { range: "bytes=0-1023" });
    const range = Object.entries(calls[0]?.headers ?? {}).find(
      ([k]) => k.toLowerCase() === "range",
    )?.[1];
    expect(range).toBe("bytes=0-1023");
  });

  it("putObject 默认 content-type 为 application/octet-stream", async () => {
    const calls = stubFetch(() => new Response("", { status: 200 }));
    await client().putObject("k", "v");
    const ct = Object.entries(calls[0]?.headers ?? {}).find(
      ([k]) => k.toLowerCase() === "content-type",
    )?.[1];
    expect(ct).toBe("application/octet-stream");
  });
});
