/**
 * @nuln/worker-kit/s3/client
 *
 * 全云兼容通用 S3 客户端
 * 原生支持 AWS S3, Cloudflare R2, MinIO, Wasabi, Backblaze B2, 阿里云 OSS, 腾讯云 COS
 */

import { signS3Request, createPresignedUrl } from "./sigv4.js";
import type {
  S3ClientConfig,
  CreateMultipartOptions,
  CompletedMultipartResult,
  GetObjectOptions,
  HeadObjectResult,
  ListObjectsOptions,
  ListObjectsResult,
  PresignedUrlOptions,
  PutObjectOptions,
  PutObjectResult,
  S3ObjectSummary,
  UploadMultipartOptions,
  UploadedPart,
} from "./types.js";
import { MAX_PARTS, MIN_PART_SIZE } from "./types.js";

/** 从 XML 响应里取第一个同名标签的内容 */
function xmlTag(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  if (m) return m[1];
  // 自闭合形式（无内容）也算存在
  return new RegExp(`<${tag}[^>]*/>`).test(xml) ? "" : undefined;
}

/** 去掉 XML 实体（ETag 里的引号必须原样保留，故不处理 `&quot;`） */
function decodeXmlText(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}

/**
 * 把 S3 object key 逐段百分号编码（保留 `/` 分隔符语义）。
 *
 * 分隔符 `/` 保持原样（表示 key 的层级），其余字符按 UTF-8 字节编码，
 * 因此 `?` `#` `%` 空格等 key 字符不会被 URL 解析器误解释。
 */
function encodeKeyPath(key: string): string {
  if (!key) return "";

  const segments = key.split("/");

  // `.` / `..` 段无法在 path-style URL 中忠实表达：`encodeURIComponent` 不编码
  // 点（RFC 3986 unreserved），而 `new URL()` 会把 `a/../b` 规范化成 `b` ——
  // 于是请求被发往一个与 key 不同的对象。这里明确拒绝而不是静默改写：
  // 静默改写会让 getObject / deleteObject / 预签名 URL 全部指向错误的对象。
  for (const seg of segments) {
    if (seg === "." || seg === "..") {
      throw new Error(
        `Invalid S3 object key: relative path segment "${seg}" is not supported ` +
          `in path-style URLs (key=${JSON.stringify(key)}). ` +
          `Use flat segment names instead.`,
      );
    }
  }

  return segments.map((seg) => encodeURIComponent(seg)).join("/");
}

export class S3Client {
  readonly endpoint: URL;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly region: string;
  readonly forcePathStyle: boolean;

  constructor(config: S3ClientConfig) {
    if (!config.endpoint) throw new Error("S3Client: endpoint is required");
    if (!config.bucket) throw new Error("S3Client: bucket is required");
    if (!config.accessKeyId) throw new Error("S3Client: accessKeyId is required");
    if (!config.secretAccessKey) throw new Error("S3Client: secretAccessKey is required");

    let ep = config.endpoint.trim();
    if (!ep.startsWith("http://") && !ep.startsWith("https://")) {
      ep = "https://" + ep;
    }
    this.endpoint = new URL(ep);
    this.bucket = config.bucket.trim();
    this.accessKeyId = config.accessKeyId.trim();
    this.secretAccessKey = config.secretAccessKey.trim();
    this.sessionToken = config.sessionToken;

    // 智能推导是否强制 Path-Style 寻址
    const host = this.endpoint.hostname.toLowerCase();
    const isIpOrLocal =
      host === "localhost" ||
      host === "127.0.0.1" ||
      /^(\d{1,3}\.){3}\d{1,3}$/.test(host) ||
      host.includes(".r2.cloudflarestorage.com");

    this.forcePathStyle =
      config.forcePathStyle !== undefined
        ? config.forcePathStyle
        : config.provider === "minio" || config.provider === "r2" || isIpOrLocal;

    // 智能推导 Region 区域名
    this.region = this.resolveRegion(config);
  }

  private resolveRegion(config: S3ClientConfig): string {
    if (config.region) return config.region.trim();
    if (config.provider === "r2") return "auto";

    const host = this.endpoint.hostname.toLowerCase();

    // 阿里云 OSS: oss-cn-hangzhou.aliyuncs.com -> cn-hangzhou
    const ossMatch = host.match(/oss-([a-z0-9-]+)\.aliyuncs\.com/);
    if (ossMatch) return ossMatch[1];

    // 腾讯云 COS: cos.ap-shanghai.myqcloud.com -> ap-shanghai
    const cosMatch = host.match(/cos\.([a-z0-9-]+)\.myqcloud\.com/);
    if (cosMatch) return cosMatch[1];

    // AWS S3: s3.us-west-2.amazonaws.com -> us-west-2
    const awsMatch = host.match(/s3[.-]([a-z0-9-]+)\.amazonaws\.com/);
    if (awsMatch) return awsMatch[1];

    // Wasabi: s3.us-east-2.wasabisys.com -> us-east-2
    const wasabiMatch = host.match(/s3\.([a-z0-9-]+)\.wasabisys\.com/);
    if (wasabiMatch) return wasabiMatch[1];

    // Backblaze B2: s3.us-west-002.backblazeb2.com -> us-west-002
    const b2Match = host.match(/s3\.([a-z0-9-]+)\.backblazeb2\.com/);
    if (b2Match) return b2Match[1];

    return "us-east-1";
  }

  /**
   * 构造标准 S3 目标 URL (自动处理 Path-Style 与 Virtual-Hosted-Style)
   */
  resolveUrl(key = "", query?: Record<string, string>): URL {
    const cleanKey = key.replace(/^\/+/, "");
    // 逐段百分号编码后拼接。
    //
    // S3 的 key 是**任意字节序列**，`?` `#` `.` `..` 全都是合法 key 字符。
    // 历史实现把原始 key 直接交给 `new URL(拼接字符串)`，URL 解析器会：
    //   key="a?b"      → 解析为 path="/a" + query="b"    （key 被截断）
    //   key="a#b"      → 解析为 path="/a" + fragment="b" （fragment 根本不上行）
    //   key="dir/../x" → 路径被规范化 → "/x"             （逃出预期 key）
    // 结果是对象被写到**错误的 key**，而 getObject / deleteObject / 预签名 URL
    // 同样受害 —— 预签名 URL 会指向一个不存在的对象。
    const encodedKey = encodeKeyPath(cleanKey);

    let targetUrl: URL;

    if (this.forcePathStyle) {
      // Path-Style: https://endpoint/bucket/key
      const basePath = this.endpoint.pathname.replace(/\/+$/, "");
      const fullPath = `${basePath}/${encodeURIComponent(this.bucket)}${encodedKey ? "/" + encodedKey : ""}`;
      targetUrl = new URL(fullPath, this.endpoint.origin);
    } else {
      // Virtual-Hosted-Style: https://bucket.endpoint/key
      const host = `${this.bucket}.${this.endpoint.host}`;
      targetUrl = new URL(`${this.endpoint.protocol}//${host}/${encodedKey}`);
    }

    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) targetUrl.searchParams.set(k, v);
      }
    }

    return targetUrl;
  }

  /**
   * 上传对象 (PUT Object)
   */
  async putObject(
    key: string,
    data: string | Uint8Array | ArrayBuffer,
    options: PutObjectOptions = {}
  ): Promise<PutObjectResult> {
    const url = this.resolveUrl(key);
    const headers: Record<string, string> = {
      "content-type": options.contentType || "application/octet-stream",
    };

    if (options.cacheControl) headers["cache-control"] = options.cacheControl;
    if (options.contentDisposition) headers["content-disposition"] = options.contentDisposition;

    if (options.metadata) {
      for (const [mk, mv] of Object.entries(options.metadata)) {
        headers[`x-amz-meta-${mk.toLowerCase()}`] = mv;
      }
    }

    const { headers: signedHeaders } = await signS3Request({
      method: "PUT",
      url,
      headers,
      body: data,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      sessionToken: this.sessionToken,
      region: this.region,
    });

    const res = await fetch(url.toString(), {
      method: "PUT",
      headers: signedHeaders,
      body: data as BodyInit,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`S3Client.putObject failed [${res.status}]: ${errText || res.statusText}`);
    }

    return {
      etag: res.headers.get("etag")?.replace(/"/g, "") || undefined,
      versionId: res.headers.get("x-amz-version-id") || undefined,
    };
  }

  /**
   * 获取对象 (GET Object)
   */
  async getObject(key: string, options: GetObjectOptions = {}): Promise<Response> {
    const url = this.resolveUrl(key);
    const headers: Record<string, string> = {};
    if (options.range) {
      headers["range"] = options.range;
    }

    const { headers: signedHeaders } = await signS3Request({
      method: "GET",
      url,
      headers,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      sessionToken: this.sessionToken,
      region: this.region,
    });

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: signedHeaders,
    });

    if (!res.ok && res.status !== 206) {
      const errText = await res.text().catch(() => "");
      throw new Error(`S3Client.getObject failed [${res.status}]: ${errText || res.statusText}`);
    }

    return res;
  }

  /**
   * 查询对象元信息 (HEAD Object)
   */
  async headObject(key: string): Promise<HeadObjectResult> {
    const url = this.resolveUrl(key);
    const { headers: signedHeaders } = await signS3Request({
      method: "HEAD",
      url,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      sessionToken: this.sessionToken,
      region: this.region,
    });

    const res = await fetch(url.toString(), {
      method: "HEAD",
      headers: signedHeaders,
    });

    if (res.status === 404) {
      return { exists: false };
    }

    if (!res.ok) {
      throw new Error(`S3Client.headObject failed [${res.status}]: ${res.statusText}`);
    }

    const metadata: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      if (k.startsWith("x-amz-meta-")) {
        metadata[k.replace("x-amz-meta-", "")] = v;
      }
    });

    const size = res.headers.get("content-length") ? parseInt(res.headers.get("content-length")!, 10) : undefined;

    return {
      exists: true,
      size,
      contentType: res.headers.get("content-type") || undefined,
      lastModified: res.headers.get("last-modified") || undefined,
      etag: res.headers.get("etag")?.replace(/"/g, "") || undefined,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
  }

  /**
   * 删除对象 (DELETE Object)
   */
  async deleteObject(key: string): Promise<void> {
    const url = this.resolveUrl(key);
    const { headers: signedHeaders } = await signS3Request({
      method: "DELETE",
      url,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      sessionToken: this.sessionToken,
      region: this.region,
    });

    const res = await fetch(url.toString(), {
      method: "DELETE",
      headers: signedHeaders,
    });

    if (!res.ok && res.status !== 204 && res.status !== 404) {
      const errText = await res.text().catch(() => "");
      throw new Error(`S3Client.deleteObject failed [${res.status}]: ${errText || res.statusText}`);
    }
  }

  /**
   * 列出存储桶对象 (ListObjectsV2)
   */
  async listObjects(options: ListObjectsOptions = {}): Promise<ListObjectsResult> {
    const query: Record<string, string> = {
      "list-type": "2",
    };
    if (options.prefix) query["prefix"] = options.prefix;
    if (options.delimiter) query["delimiter"] = options.delimiter;
    if (options.maxKeys) query["max-keys"] = String(options.maxKeys);
    if (options.continuationToken) query["continuation-token"] = options.continuationToken;

    const url = this.resolveUrl("", query);

    const { headers: signedHeaders } = await signS3Request({
      method: "GET",
      url,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      sessionToken: this.sessionToken,
      region: this.region,
    });

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: signedHeaders,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`S3Client.listObjects failed [${res.status}]: ${errText || res.statusText}`);
    }

    const xml = await res.text();
    return this.parseListObjectsXml(xml);
  }

  /**
   * 生成带签名的临时预签名链接 (Presigned URL)
   */
  async getPresignedUrl(key: string, options: PresignedUrlOptions = {}): Promise<string> {
    const url = this.resolveUrl(key);
    return await createPresignedUrl({
      method: options.method || "GET",
      url,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      sessionToken: this.sessionToken,
      region: this.region,
      expiresIn: options.expiresIn ?? 3600,
    });
  }

  /* ==================================================== 分块上传 (Multipart) */

  /**
   * 发起分块上传，返回 uploadId。
   *
   * 元数据（content-type / x-amz-meta-*）只在**这一步**指定，
   * 后续每个分片不再携带 —— 服务端会把它们应用到最终对象。
   *
   * @throws 响应非 2xx 时抛错，错误体内含服务端返回的 code 与 message
   */
  async createMultipartUpload(
    key: string,
    options: CreateMultipartOptions = {}
  ): Promise<string> {
    const url = this.resolveUrl(key, { uploads: "" });
    const headers = this.buildObjectHeaders(options);

    const { headers: signedHeaders } = await signS3Request({
      method: "POST",
      url,
      headers,
      body: "",
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      sessionToken: this.sessionToken,
      region: this.region,
    });

    const res = await fetch(url.toString(), { method: "POST", headers: signedHeaders });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `S3Client.createMultipartUpload failed [${res.status}]: ${errText || res.statusText}`,
      );
    }
    const xml = await res.text();
    const uploadId = decodeXmlText(xmlTag(xml, "UploadId"));
    if (!uploadId) {
      // 服务端返回 200 却没有 UploadId：继续下去必然在 complete 时失败，
      // 不如在这里就明确报出来
      throw new Error("S3Client.createMultipartUpload: 响应中缺少 UploadId");
    }
    return uploadId;
  }

  /**
   * 上传单个分片。
   *
   * @param partNumber 从 1 开始
   * @param body 分片内容；长度必须 ≥ 5MB（末片除外），否则服务端 400
   * @returns 含 partNumber 与 ETag；**ETag 必须带引号原样回传给 complete**
   */
  async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: ArrayBuffer | Uint8Array,
  ): Promise<UploadedPart> {
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) {
      throw new Error(
        `S3Client.uploadPart: partNumber 必须是 1~${MAX_PARTS} 的整数，收到 ${partNumber}`,
      );
    }
    const url = this.resolveUrl(key, { partNumber: String(partNumber), uploadId });
    // 分片请求不带 content-type：S3 忽略它，且会污染签名
    const { headers: signedHeaders } = await signS3Request({
      method: "PUT",
      url,
      headers: {},
      body,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      sessionToken: this.sessionToken,
      region: this.region,
    });

    const res = await fetch(url.toString(), {
      method: "PUT",
      headers: signedHeaders,
      body: body as BodyInit,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `S3Client.uploadPart #${partNumber} failed [${res.status}]: ${errText || res.statusText}`,
      );
    }

    const etag = res.headers.get("etag");
    if (!etag) {
      // 缺 ETag 就没有 complete 所需的凭据。与其到 complete 才报
      // InvalidPart，不如在这里拦住并带上分片号
      throw new Error(`S3Client.uploadPart #${partNumber}: 响应缺少 ETag 头`);
    }
    // ETag 保留引号：complete 时必须原样回传
    return { partNumber, eTag: etag };
  }

  /**
   * 完成分块上传，提交全部分片清单。
   *
   * 分片必须按 partNumber **升序**提交，否则 S3 返回 400
   * `InvalidPartOrder` —— 故这里主动排序，而不是信任调用方的顺序。
   *
   * @param parts 分片清单（内部会按序号排序）
   */
  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: UploadedPart[],
    options: CreateMultipartOptions = {}
  ): Promise<CompletedMultipartResult> {
    if (!Array.isArray(parts) || parts.length === 0) {
      throw new Error("S3Client.completeMultipartUpload: 分片清单为空");
    }
    if (parts.length > MAX_PARTS) {
      throw new Error(
        `S3Client.completeMultipartUpload: 分片数 ${parts.length} 超过上限 ${MAX_PARTS}`,
      );
    }

    // 升序 —— S3 强制要求
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    // 序号必须从 1 连续递增
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i]!.partNumber !== i + 1) {
        throw new Error(
          `S3Client.completeMultipartUpload: partNumber 必须从 1 连续递增，` +
            `第 ${i + 1} 项收到 ${ordered[i]!.partNumber}`,
        );
      }
    }

    const url = this.resolveUrl(key, { uploadId });
    const body =
      "<CompleteMultipartUpload>" +
      ordered
        .map((p) => {
          // ETag 形如 "md5"，引号必须转义为 &quot; ——
          // 否则 CompleteMultipartUpload 请求体不是合法 XML，
          // 服务端返回 400 MalformedXML，且错误信息完全指不到点子上
          const safeETag = String(p.eTag)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
          return `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${safeETag}</ETag></Part>`;
        })
        .join("") +
      "</CompleteMultipartUpload>";

    const { headers: signedHeaders } = await signS3Request({
      method: "POST",
      url,
      headers: { "content-type": "application/xml" },
      body,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      sessionToken: this.sessionToken,
      region: this.region,
    });

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: signedHeaders,
      body,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `S3Client.completeMultipartUpload failed [${res.status}]: ${errText || res.statusText}`,
      );
    }

    const xml = await res.text();
    return {
      key: decodeXmlText(xmlTag(xml, "Key")) ?? key,
      etag: res.headers.get("etag")?.replace(/"/g, "") || undefined,
      versionId: res.headers.get("x-amz-version-id") || undefined,
      partCount: ordered.length,
      // S3 的 CompleteMultipartUpload 响应不返回大小；由调用方或辅助函数填充
      size: 0,
    };
  }

  /**
   * 放弃分块上传并删除已上传的分片。
   *
   * **失败即抛错，且不吞异常**：调用方（通常是 `catch` 块）需要知道
   * 有残留分片要清理 —— 不清理会持续占用配额。
   */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    const url = this.resolveUrl(key, { uploadId });
    const { headers: signedHeaders } = await signS3Request({
      method: "DELETE",
      url,
      headers: {},
      body: "",
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      sessionToken: this.sessionToken,
      region: this.region,
    });

    const res = await fetch(url.toString(), { method: "DELETE", headers: signedHeaders });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `S3Client.abortMultipartUpload failed [${res.status}]: ${errText || res.statusText}`,
      );
    }
  }

  /** 把对象级元数据摊平成请求头（putObject 与 createMultipartUpload 共用） */
  private buildObjectHeaders(options: CreateMultipartOptions): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": options.contentType || "application/octet-stream",
    };
    if (options.cacheControl) headers["cache-control"] = options.cacheControl;
    if (options.contentDisposition) headers["content-disposition"] = options.contentDisposition;
    if (options.metadata) {
      for (const [mk, mv] of Object.entries(options.metadata)) {
        headers[`x-amz-meta-${mk.toLowerCase()}`] = mv;
      }
    }
    return headers;
  }

  /**
   * 轻量级 S3 ListObjectsV2 XML 响应解析器
   */
  private parseListObjectsXml(xml: string): ListObjectsResult {
    const objects: S3ObjectSummary[] = [];
    const commonPrefixes: string[] = [];

    // 匹配所有 <Contents> 块
    const contentsMatches = xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g);
    for (const match of contentsMatches) {
      const block = match[1];
      const keyMatch = block.match(/<Key>(.*?)<\/Key>/);
      const sizeMatch = block.match(/<Size>(.*?)<\/Size>/);
      const lastModifiedMatch = block.match(/<LastModified>(.*?)<\/LastModified>/);
      const etagMatch = block.match(/<ETag>(.*?)<\/ETag>/);

      if (keyMatch && keyMatch[1]) {
        objects.push({
          key: this.decodeXmlEntities(keyMatch[1]),
          size: sizeMatch ? parseInt(sizeMatch[1], 10) : 0,
          lastModified: lastModifiedMatch ? lastModifiedMatch[1] : "",
          etag: etagMatch ? this.decodeXmlEntities(etagMatch[1]).replace(/"/g, "") : "",
        });
      }
    }

    // 匹配所有 <CommonPrefixes><Prefix> 块
    const prefixMatches = xml.matchAll(/<CommonPrefixes>[\s\S]*?<Prefix>(.*?)<\/Prefix>[\s\S]*?<\/CommonPrefixes>/g);
    for (const match of prefixMatches) {
      if (match[1]) commonPrefixes.push(this.decodeXmlEntities(match[1]));
    }

    const isTruncatedMatch = xml.match(/<IsTruncated>(.*?)<\/IsTruncated>/);
    const isTruncated = isTruncatedMatch ? isTruncatedMatch[1].toLowerCase() === "true" : false;

    const nextTokenMatch = xml.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/);
    const nextContinuationToken = nextTokenMatch ? this.decodeXmlEntities(nextTokenMatch[1]) : undefined;

    return {
      objects,
      commonPrefixes,
      isTruncated,
      nextContinuationToken,
      keyCount: objects.length,
    };
  }

  private decodeXmlEntities(str: string): string {
    return str
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  /* ============================================ 分页遍历 (KIT-OPT-02) */

  /**
   * 异步遍历全部对象，自动处理分页。
   *
   * ## 为什么需要它
   *
   * `listObjects` 单次最多返回 1000 个对象。调用方要拿全量就必须自己写：
   * 检查 `isTruncated` → 取 `nextContinuationToken` → 循环。这段样板在
   * 备份巡检、历史清理里会重复出现，而**漏掉 `isTruncated` 判断**只会在
   * 对象数超过 1000 时才暴露 —— 表现为"清理不干净"或"备份不完整"，
   * 静默且难查。
   *
   * 用法：
   * ```ts
   * for await (const obj of client.listObjectsIterator("backups/")) {
   *   console.log(obj.key, obj.size);
   * }
   * ```
   *
   * @param prefix 键前缀；为空则遍历全桶
   * @param options 额外列举参数（分页相关字段由本函数维护，不要传入）
   * @param fetchImpl 可注入的 fetch（测试用）
   */
  async *listObjectsIterator(
    prefix?: string,
    options: Omit<ListObjectsOptions, "continuationToken" | "prefix"> = {},
  ): AsyncGenerator<S3ObjectSummary, void, undefined> {
    let token: string | undefined;
    // 防御性上限：若服务端行为异常导致 isTruncated 永远为 true，
    // 无限循环会耗尽 Worker 的执行时长
    let pages = 0;
    const MAX_PAGES = 10_000;

    do {
      const page = await this.listObjects({
        prefix,
        ...options,
        continuationToken: token,
      });
      for (const obj of page.objects) yield obj;
      token = page.isTruncated ? page.nextContinuationToken : undefined;
      if (++pages >= MAX_PAGES) {
        throw new Error(
          `S3Client.listObjectsIterator: 超过 ${MAX_PAGES} 页仍未结束分页，` +
            `疑似服务端持续返回 isTruncated`,
        );
      }
    } while (token);
  }
}

/**
 * 工厂函数：创建 S3Client
 */
export function createS3Client(config: S3ClientConfig): S3Client {
  return new S3Client(config);
}

/* ============================================ 分块上传辅助 */

/**
 * 把一个整体载荷切成若干分片。
 *
 * 纯函数（不碰网络），便于单测与自定义传输层复用。
 *
 * ## 分片规则
 *
 * S3 要求**除末片外**每片 ≥ 5MB。故若总大小 < partSize，返回**一片**
 * （允许小于 5MB，因为它是末片）。若总大小 ≥ partSize，则每片恰为
 * partSize，最后一片为余数。
 *
 * @param data 整体载荷
 * @param partSize 分片大小；会被夹到 ≥ {@link MIN_PART_SIZE}
 * @returns 顺序分片数组
 */
export function splitIntoParts(
  data: Uint8Array,
  partSize: number = MIN_PART_SIZE,
): Uint8Array[] {
  const size = Math.max(MIN_PART_SIZE, Math.floor(partSize));
  if (data.byteLength <= size) return [data];
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < data.byteLength; offset += size) {
    parts.push(data.subarray(offset, Math.min(offset + size, data.byteLength)));
  }
  // 片数超限时明确报错：S3 只接受 10000 片，
  // 与其上传到一半才失败，不如在切分阶段就拦下
  if (parts.length > MAX_PARTS) {
    throw new Error(
      `splitIntoParts: 需要 ${parts.length} 片，超过 S3 上限 ${MAX_PARTS}；请增大 partSize`,
    );
  }
  return parts;
}

/**
 * 高阶分块上传：自动切分、限流并发、单片重试、失败自动 abort。
 *
 * ## 关于「自动计算 ETag」
 *
 * 本函数**不**在客户端计算任何摘要，而是收集服务端对每个分片返回的 ETag
 * 并在 complete 时原样回传。
 *
 * 这是 S3 协议的要求，不是省事：分块对象的整体 ETag 是
 * `md5(所有分片 MD5 的拼接)` 再拼 `-<分片数>`，**只能**由持有全部
 * 分片的服务端算出。客户端自己算一份交上去，服务端会比对不上并返回
 * 400 `InvalidPart`。
 *
 * 辅助函数自动做了三件事，因此"自动"成立：切分（5MB 对齐）、
 * 按 partNumber 升序收集、complete 时回传全部 ETag。
 *
 * ## 为什么必须有 abort
 *
 * 分块上传的每个分片都会**立即**占用 S3 配额。若在第 7 片失败后直接
 * 抛错，已传的 6 片会一直挂着，直到服务端生命周期规则（默认 7 天）到期。
 * 反复失败几次就把配额吃满。故任何失败路径都先 abort 再抛。
 *
 * @param client S3 客户端
 * @param key 对象键
 * @param data 整体载荷
 * @param options 分片与并发配置
 * @returns 完成后的对象信息
 * @throws 分片/完成失败时抛错（已自动 abort）
 */
export async function uploadMultipartFromChunks(
  client: S3Client,
  key: string,
  data: ArrayBuffer | Uint8Array,
  options: UploadMultipartOptions = {},
): Promise<CompletedMultipartResult> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const partSize = options.partSize ?? MIN_PART_SIZE;
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const retries = Math.max(0, options.retriesPerPart ?? 2);

  const parts = splitIntoParts(bytes, partSize);
  const totalBytes = bytes.byteLength;

  // 空载荷也要走完整流程：S3 不接受零字节的 multipart 对象，
  // 但"上传一个空文件"是合法意图，故用单片（末片可为 0 字节）
  const uploadId = await client.createMultipartUpload(key, options);

  const done: UploadedPart[] = [];
  let uploadedBytes = 0;

  try {
    let cursor = 0;
    // 固定数量的 worker 从共享游标取任务：比每次 shift() 更省，
    // 且天然实现"取完即止"
    const workers = Array.from({ length: Math.min(concurrency, parts.length) }, async () => {
      for (;;) {
        const idx = cursor++;
        if (idx >= parts.length) return;
        const partNumber = idx + 1;
        const body = parts[idx]!;

        let lastErr: unknown;
        for (let attempt = 0; attempt <= retries; attempt++) {
          try {
            const uploaded = await client.uploadPart(key, uploadId, partNumber, body);
            done.push(uploaded);
            uploadedBytes += body.byteLength;
            // 进度回调抛错不得影响上传
            try {
              options.onProgress?.({
                uploadedParts: done.length,
                totalParts: parts.length,
                uploadedBytes,
                totalBytes,
              });
            } catch {
              /* 进度上报失败不影响上传 */
            }
            lastErr = undefined;
            break;
          } catch (err) {
            lastErr = err;
          }
        }
        if (lastErr) {
          throw new Error(
            `分片 #${partNumber}/${parts.length} 上传失败（重试 ${retries} 次后）: ` +
              `${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
          );
        }
      }
    });

    await Promise.all(workers);

    const result = await client.completeMultipartUpload(key, uploadId, done, options);
    return { ...result, size: totalBytes };
  } catch (err) {
    // 失败必须清理：残留分片会占配额直到生命周期到期
    try {
      await client.abortMultipartUpload(key, uploadId);
    } catch (abortErr) {
      // 清理失败不能掩盖原始错误，但必须让人知道有残留
      console.error(
        `[S3] 分块上传失败后 abort 也失败 (key=${key}, uploadId=${uploadId})，` +
          `残留分片会占用配额直到生命周期到期:`,
        abortErr,
      );
    }
    throw err;
  }
}
