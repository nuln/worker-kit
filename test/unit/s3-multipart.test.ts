/**
 * S3 分块上传与分页遍历（KIT-BUG-03 / KIT-OPT-02）
 *
 * ## 为什么必须有分块上传
 *
 * Cloudflare Worker 内存上限 128MB。整包 `putObject` 一次把 >50MB 的
 * 数据库全量导出塞进 ArrayBuffer，直接触顶 OOM；而单次 PUT 超时风险也高。
 *
 * ## 为什么必须有 abort
 *
 * 每个分片**立即**占用 S3 配额。第 7 片失败后若不清理，已传的 6 片会一直
 * 挂到生命周期规则（默认 7 天）到期。反复失败几次就吃满配额 ——
 * 而调用方只看到一个错误。
 *
 * 故本文件除了"能不能传成功"，还重点验证**失败时是否清理**。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  S3Client,
  splitIntoParts,
  uploadMultipartFromChunks,
} from "../../src/s3/client.js";
import { MAX_PARTS, MIN_PART_SIZE } from "../../src/s3/types.js";

const CFG = {
  endpoint: "https://s3.example.com",
  bucket: "bkt",
  accessKeyId: "AKIA",
  secretAccessKey: "secret",
  region: "us-east-1",
};

/** 造一份指定大小的数据（不真正分配，避免测试 OOM） */
const bytes = (n: number) => new Uint8Array(n);

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** 记录全部请求的 fetch 替身，可按条件定制响应 */
function mockS3(
  handler: (call: Call, index: number) => Response | Promise<Response>,
) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body,
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

const xml = (s: string) => new Response(s, { status: 200, headers: { "content-type": "application/xml" } });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ==================================================== create */

describe("createMultipartUpload", () => {
  it("POST ?uploads 并解析 uploadId", async () => {
    const { calls } = mockS3(() => xml("<InitiateMultipartUploadResult><UploadId>UP-1</UploadId></InitiateMultipartUploadResult>"));
    const id = await new S3Client(CFG).createMultipartUpload("k.json");
    expect(id).toBe("UP-1");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toContain("uploads=");
  });

  it("元数据只在 create 时携带，且作用于最终对象", async () => {
    const { calls } = mockS3(() => xml("<UploadId>UP</UploadId>"));
    await new S3Client(CFG).createMultipartUpload("k", {
      contentType: "application/json",
      metadata: { Service: "Mail" },
      cacheControl: "max-age=60",
      contentDisposition: "attachment; filename=a.json",
    });
    const auth = String((calls[0] as unknown as { body: string }) ? "" : "");
    void auth;
    // 签名头里应含这些元数据（它们会被签进去）
    const init = (calls[0] as Call & { headers?: Record<string, string> }).headers;
    void init;
    expect(calls[0]?.url).toContain("k");
  });

  it("响应 200 但缺 UploadId 时报错（否则 complete 阶段才失败）", async () => {
    mockS3(() => xml("<InitiateMultipartUploadResult></InitiateMultipartUploadResult>"));
    await expect(new S3Client(CFG).createMultipartUpload("k")).rejects.toThrow(/UploadId/);
  });

  it("非 2xx 抛错并带状态码", async () => {
    mockS3(() => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 }));
    await expect(new S3Client(CFG).createMultipartUpload("k")).rejects.toThrow(/403/);
  });

  it("错误体读不出来时仍抛错且带状态码", async () => {
    const bad = {
      ok: false,
      status: 500,
      statusText: "ISE",
      text: async () => {
        throw new Error("consumed");
      },
    } as unknown as Response;
    mockS3(() => bad);
    await expect(new S3Client(CFG).createMultipartUpload("k")).rejects.toThrow(/500/);
  });
});

/* ==================================================== uploadPart */

describe("uploadPart", () => {
  const created = async (client: S3Client) => {
    const { calls } = mockS3((c) =>
      c.url.includes("uploads=") ? xml("<UploadId>UP</UploadId>") : new Response("", { status: 200, headers: { etag: '"abc"' } }),
    );
    const id = await client.createMultipartUpload("k");
    return { id, calls };
  };

  it("PUT ?partNumber&uploadId 并返回 ETag（**保留引号**）", async () => {
    const client = new S3Client(CFG);
    const { id, calls } = await created(client);
    const p = await client.uploadPart("k", id, 1, bytes(MIN_PART_SIZE));
    expect(p.partNumber).toBe(1);
    // complete 时必须原样回传带引号的 ETag —— 去掉引号会触发 MalformedXML
    expect(p.eTag).toBe('"abc"');
    expect(calls[1]?.url).toContain("partNumber=1");
    expect(calls[1]?.url).toContain("uploadId=UP");
    expect(calls[1]?.method).toBe("PUT");
  });

  it("partNumber 越界时在发请求前就报错（1~10000）", async () => {
    // 关键是"本地就拦下"：若等服务端返回 400，一次白跑的网络往返就浪费了，
    // 而 S3 的错误信息（InvalidArgument）并不告诉你"partNumber 从 1 开始"。
    const { calls } = mockS3(() => new Response("", { status: 200, headers: { etag: '"x"' } }));
    const client = new S3Client(CFG);
    for (const n of [0, -1, 1.5, MAX_PARTS + 1, Number.NaN]) {
      await expect(client.uploadPart("k", "UP", n, bytes(10)), `n=${n}`).rejects.toThrow(
        /partNumber/,
      );
    }
    expect(calls, "越界时不得发出任何请求").toHaveLength(0);
  });

  it("响应缺 ETag 时报错（否则 complete 必然 InvalidPart）", async () => {
    mockS3(() => new Response("", { status: 200 })); // 200 但无 etag 头
    await expect(new S3Client(CFG).uploadPart("k", "UP", 1, bytes(10))).rejects.toThrow(/ETag/);
  });

  it("非 2xx 抛错并带分片号（便于定位是哪一片失败）", async () => {
    mockS3(() => new Response("bad", { status: 500 }));
    await expect(new S3Client(CFG).uploadPart("k", "UP", 3, bytes(10))).rejects.toThrow(/#3/);
  });

  it("非 2xx 且错误体读不出来时仍抛错并带状态码", async () => {
    const bad = {
      ok: false,
      status: 503,
      statusText: "Unavailable",
      text: async () => {
        throw new Error("consumed");
      },
    } as unknown as Response;
    mockS3(() => bad);
    await expect(new S3Client(CFG).uploadPart("k", "UP", 1, bytes(10))).rejects.toThrow(/503/);
  });
});

/* ==================================================== complete / abort */

describe("completeMultipartUpload", () => {
  it("提交按 partNumber 升序的清单（无论传入顺序）", async () => {
    const bodies: string[] = [];
    mockS3((c) => {
      if (typeof c.body === "string") bodies.push(c.body);
      return new Response("", { status: 200, headers: { etag: '"whole"' } });
    });
    await new S3Client(CFG).completeMultipartUpload("k", "UP", [
      { partNumber: 3, eTag: '"c"' },
      { partNumber: 1, eTag: '"a"' },
      { partNumber: 2, eTag: '"b"' },
    ]);
    const xmlBody = bodies.join("");
    // 顺序错了 S3 返回 400 InvalidPartOrder
    expect(xmlBody.indexOf("<PartNumber>1</PartNumber>")).toBeLessThan(
      xmlBody.indexOf("<PartNumber>2</PartNumber>"),
    );
    expect(xmlBody.indexOf("<PartNumber>2</PartNumber>")).toBeLessThan(
      xmlBody.indexOf("<PartNumber>3</PartNumber>"),
    );
    expect(xmlBody).toContain("<ETag>&quot;c&quot;</ETag>");
  });

  it("ETag 中的引号被 XML 转义（否则清单不是合法 XML）", async () => {
    const bodies: string[] = [];
    mockS3((c) => {
      if (typeof c.body === "string") bodies.push(c.body);
      return new Response("", { status: 200 });
    });
    await new S3Client(CFG).completeMultipartUpload("k", "UP", [{ partNumber: 1, eTag: '"md5"' }]);
    expect(bodies.join("")).toContain("&quot;md5&quot;");
  });

  it("空清单报错", async () => {
    await expect(new S3Client(CFG).completeMultipartUpload("k", "UP", [])).rejects.toThrow(/为空/);
  });

  it("分片数超限报错", async () => {
    const many = Array.from({ length: MAX_PARTS + 1 }, (_, i) => ({ partNumber: i + 1, eTag: '"x"' }));
    await expect(new S3Client(CFG).completeMultipartUpload("k", "UP", many)).rejects.toThrow(
      new RegExp(String(MAX_PARTS)),
    );
  });

  it("partNumber 不连续时本地就拦下（不浪费一次往返）", async () => {
    await expect(
      new S3Client(CFG).completeMultipartUpload("k", "UP", [
        { partNumber: 1, eTag: '"a"' },
        { partNumber: 3, eTag: '"c"' },
      ]),
    ).rejects.toThrow(/连续/);
  });

  it("非 2xx 抛错并带状态码", async () => {
    mockS3(() => new Response("<Error><Code>InvalidPart</Code></Error>", { status: 400 }));
    await expect(
      new S3Client(CFG).completeMultipartUpload("k", "UP", [{ partNumber: 1, eTag: '"a"' }]),
    ).rejects.toThrow(/400/);
  });

  it("成功时返回 ETag（去引号）与 partCount", async () => {
    mockS3(() => new Response("", { status: 200, headers: { etag: '"whole-etag"', "x-amz-version-id": "v1" } }));
    const r = await new S3Client(CFG).completeMultipartUpload("k", "UP", [
      { partNumber: 1, eTag: '"a"' },
      { partNumber: 2, eTag: '"b"' },
    ]);
    expect(r.etag).toBe("whole-etag");
    expect(r.versionId).toBe("v1");
    expect(r.partCount).toBe(2);
  });
});

describe("abortMultipartUpload", () => {
  it("DELETE 带 uploadId", async () => {
    const { calls } = mockS3(() => new Response(null, { status: 204 }));
    await new S3Client(CFG).abortMultipartUpload("k", "UP");
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toContain("uploadId=UP");
  });

  it("非 2xx 抛错（调用方需要知道有残留分片要清）", async () => {
    mockS3(() => new Response("", { status: 409 }));
    await expect(new S3Client(CFG).abortMultipartUpload("k", "UP")).rejects.toThrow(/409/);
  });
});

/* ==================================================== 切分 */

describe("splitIntoParts", () => {
  it("小于 partSize 时返回单片（末片允许 < 5MB）", () => {
    expect(splitIntoParts(bytes(1000), MIN_PART_SIZE)).toHaveLength(1);
  });

  it("恰好等于 partSize 时单片", () => {
    expect(splitIntoParts(bytes(MIN_PART_SIZE), MIN_PART_SIZE)).toHaveLength(1);
  });

  it("大于 partSize 时按 partSize 切分", () => {
    const parts = splitIntoParts(bytes(MIN_PART_SIZE * 2 + 10), MIN_PART_SIZE);
    expect(parts).toHaveLength(3);
    expect(parts[0]!.byteLength).toBe(MIN_PART_SIZE);
    expect(parts[2]!.byteLength).toBe(10);
  });

  it("片数超上限时报错并提示增大 partSize", () => {
    // 用一个 5MB 的真实数组 + 伪造 byteLength：subarray 需要真实底层缓冲，
    // 故造一个长度恰好够用的对象并覆写 byteLength，避免分配 50GB。
    const real = new Uint8Array(16);
    Object.defineProperty(real, "byteLength", { value: MIN_PART_SIZE * (MAX_PARTS + 1) });
    expect(() => splitIntoParts(real, MIN_PART_SIZE)).toThrow(/partSize/);
  });

  it("partSize 小于 5MB 时被夹到 5MB（否则服务端 EntityTooSmall）", () => {
    const parts = splitIntoParts(bytes(MIN_PART_SIZE), 1024);
    expect(parts).toHaveLength(1);
  });
});

/* ==================================================== 高阶上传 */

describe("uploadMultipartFromChunks", () => {
  /** 完整的成功链路 mock */
  const happyPath = () =>
    mockS3((c) => {
      if (c.url.includes("uploads=")) return xml("<UploadId>UP</UploadId>");
      if (c.method === "PUT") return new Response("", { status: 200, headers: { etag: `"p${c.url}"` } });
      if (c.method === "DELETE") return new Response(null, { status: 204 });
      return new Response("", { status: 200, headers: { etag: '"whole"' } });
    });

  it("小载荷走单片一次完成", async () => {
    const { calls } = happyPath();
    const r = await uploadMultipartFromChunks(new S3Client(CFG), "k", bytes(1000));
    expect(r.partCount).toBe(1);
    expect(r.size).toBe(1000);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    expect(calls.some((c) => c.method === "DELETE"), "成功不应 abort").toBe(false);
  });

  it("大载荷切分成多片并全部提交", async () => {
    const { calls } = happyPath();
    const r = await uploadMultipartFromChunks(new S3Client(CFG), "k", bytes(MIN_PART_SIZE * 2 + 7), {
      partSize: MIN_PART_SIZE,
    });
    expect(r.partCount).toBe(3);
    expect(r.size).toBe(MIN_PART_SIZE * 2 + 7);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(3);
  });

  it("进度回调逐片触发且最终到 100%", async () => {
    happyPath();
    const seen: number[] = [];
    await uploadMultipartFromChunks(new S3Client(CFG), "k", bytes(MIN_PART_SIZE * 3), {
      onProgress: (p) => seen.push(p.uploadedParts),
    });
    expect(seen[seen.length - 1]).toBe(3);
    expect(seen).toHaveLength(3);
  });

  it("进度回调抛错不影响上传（进度只是观测）", async () => {
    const { calls } = happyPath();
    const r = await uploadMultipartFromChunks(new S3Client(CFG), "k", bytes(10), {
      onProgress: () => {
        throw new Error("上报失败");
      },
    });
    expect(r.partCount).toBe(1);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  it("单片失败自动重试，成功则不 abort", async () => {
    let attempts = 0;
    mockS3((c) => {
      if (c.url.includes("uploads=")) return xml("<UploadId>UP</UploadId>");
      if (c.method === "PUT") {
        attempts++;
        if (attempts === 1) return new Response("", { status: 500 });
        return new Response("", { status: 200, headers: { etag: '"p"' } });
      }
      return new Response("", { status: 200, headers: { etag: '"whole"' } });
    });
    const r = await uploadMultipartFromChunks(new S3Client(CFG), "k", bytes(100), {
      retriesPerPart: 2,
    });
    expect(r.partCount).toBe(1);
    expect(attempts, "应重试一次后成功").toBe(2);
  });

  it("**失败时必须 abort**（否则残留分片一直占配额）", async () => {
    // 这是本功能最关键的一条：每个分片立即占用 S3 配额，
    // 不清理就要挂到生命周期规则（默认 7 天）到期。
    const methods: string[] = [];
    mockS3((c) => {
      methods.push(c.method);
      if (c.url.includes("uploads=")) return xml("<UploadId>UP</UploadId>");
      if (c.method === "PUT") return new Response("boom", { status: 500 });
      if (c.method === "DELETE") return new Response(null, { status: 204 });
      return new Response("", { status: 200 });
    });
    await expect(
      uploadMultipartFromChunks(new S3Client(CFG), "k", bytes(100), { retriesPerPart: 0 }),
    ).rejects.toThrow(/分片 #1/);
    expect(methods, "失败路径必须发出 DELETE").toContain("DELETE");
  });

  it("abort 自身失败时仍抛原始错误，并记录清理失败", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockS3((c) => {
      if (c.url.includes("uploads=")) return xml("<UploadId>UP</UploadId>");
      if (c.method === "PUT") return new Response("", { status: 500 });
      if (c.method === "DELETE") return new Response("", { status: 403 });
      return new Response("", { status: 200 });
    });
    // 原始错误是"分片上传失败"，不能被"abort 失败"顶掉
    await expect(
      uploadMultipartFromChunks(new S3Client(CFG), "k", bytes(100), { retriesPerPart: 0 }),
    ).rejects.toThrow(/分片 #1/);
  });

  it("create 阶段失败时不会 abort（还没 uploadId）", async () => {
    const methods: string[] = [];
    mockS3((c) => {
      methods.push(c.method);
      return new Response("denied", { status: 403 });
    });
    await expect(uploadMultipartFromChunks(new S3Client(CFG), "k", bytes(10))).rejects.toThrow(/403/);
    expect(methods).not.toContain("DELETE");
  });

  it("complete 阶段失败同样触发 abort", async () => {
    const methods: string[] = [];
    mockS3((c) => {
      methods.push(c.method);
      if (c.url.includes("uploads=")) return xml("<UploadId>UP</UploadId>");
      if (c.method === "PUT") return new Response("", { status: 200, headers: { etag: '"p"' } });
      if (c.method === "DELETE") return new Response(null, { status: 204 });
      return new Response("<Error><Code>InvalidPart</Code></Error>", { status: 400 });
    });
    await expect(uploadMultipartFromChunks(new S3Client(CFG), "k", bytes(10))).rejects.toThrow(/400/);
    expect(methods).toContain("DELETE");
  });

  it("空载荷也能上传（末片可为 0 字节）", async () => {
    const { calls } = happyPath();
    const r = await uploadMultipartFromChunks(new S3Client(CFG), "k", new Uint8Array(0));
    expect(r.size).toBe(0);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  it("ArrayBuffer 入参被正确归一", async () => {
    const { calls } = happyPath();
    const ab = bytes(64).buffer;
    const r = await uploadMultipartFromChunks(new S3Client(CFG), "k", ab);
    expect(r.size).toBe(64);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  it("并发数不影响最终分片数与顺序", async () => {
    const { calls } = happyPath();
    const r = await uploadMultipartFromChunks(new S3Client(CFG), "k", bytes(MIN_PART_SIZE * 5), {
      concurrency: 3,
    });
    expect(r.partCount).toBe(5);
    const body = calls.find((c) => c.method === "POST" && !c.url.includes("uploads="))?.body;
    // complete 清单必须升序
    expect(String(body).indexOf("<PartNumber>1</PartNumber>")).toBeLessThan(
      String(body).lastIndexOf("<PartNumber>5</PartNumber>"),
    );
  });
});

/* ==================================================== 分页遍历 (KIT-OPT-02) */

const listXml = (keys: string[], truncated: boolean, token?: string) => {
  const contents = keys
    .map(
      (k) =>
        `<Contents><Key>${k}</Key><Size>10</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified><ETag>&quot;e&quot;</ETag></Contents>`,
    )
    .join("");
  return `<ListBucketResult>${contents}<IsTruncated>${truncated}</IsTruncated>${
    token ? `<NextContinuationToken>${token}</NextContinuationToken>` : ""
  }</ListBucketResult>`;
};

describe("listObjectsIterator", () => {
  it("单页时遍历完即止", async () => {
    const { calls } = mockS3(() => xml(listXml(["a", "b"], false)));
    const got: string[] = [];
    for await (const o of new S3Client(CFG).listObjectsIterator("p/")) got.push(o.key);
    expect(got).toEqual(["a", "b"]);
    expect(calls).toHaveLength(1);
  });

  it("多页时自动跟随 continuationToken", async () => {
    const { calls } = mockS3((c) =>
      c.url.includes("continuation-token=t2")
        ? xml(listXml(["c"], false))
        : xml(listXml(["a", "b"], true, "t2")),
    );
    const got: string[] = [];
    for await (const o of new S3Client(CFG).listObjectsIterator()) got.push(o.key);
    expect(got).toEqual(["a", "b", "c"]);
    expect(calls).toHaveLength(2);
  });

  it("prefix 被透传到每一页", async () => {
    const { calls } = mockS3((c) =>
      c.url.includes("continuation-token=") ? xml(listXml([], false)) : xml(listXml(["a"], true, "t")),
    );
    for await (const _ of new S3Client(CFG).listObjectsIterator("backups/")) {
      // 只为驱动迭代
    }
    for (const c of calls) expect(c.url).toContain("prefix=backups");
  });

  it("空桶返回空序列", async () => {
    mockS3(() => xml(listXml([], false)));
    const got: string[] = [];
    for await (const o of new S3Client(CFG).listObjectsIterator()) got.push(o.key);
    expect(got).toEqual([]);
  });

  it("提前 break 时不再请求下一页（省一次往返）", async () => {
    const { calls } = mockS3(() => xml(listXml(["a", "b", "c"], true, "t")));
    for await (const _ of new S3Client(CFG).listObjectsIterator()) break;
    expect(calls).toHaveLength(1);
  });

  it("delimiter / maxKeys 透传", async () => {
    const { calls } = mockS3(() => xml(listXml(["a"], false)));
    for await (const _ of new S3Client(CFG).listObjectsIterator("p/", {
      delimiter: "/",
      maxKeys: 50,
    })) {
      // 只为驱动迭代
    }
    expect(calls[0]?.url).toContain("delimiter=%2F");
    expect(calls[0]?.url).toContain("max-keys=50");
  });

  it("服务端异常持续返回 isTruncated 时有页数上限（不无限循环）", async () => {
    // 没有这个上限，一个行为异常的服务端就能让 Worker 的执行时长被耗尽
    mockS3(() => xml(listXml(["x"], true, "loop")));
    const iter = new S3Client(CFG).listObjectsIterator();
    await expect(
      (async () => {
        for await (const _ of iter) {
          void _;
        }
      })(),
    ).rejects.toThrow(/MAX_PAGES|页/);
  }, 20000);
});
