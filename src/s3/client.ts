/**
 * @nuln/worker-kit/s3/client
 *
 * 全云兼容通用 S3 客户端
 * 原生支持 AWS S3, Cloudflare R2, MinIO, Wasabi, Backblaze B2, 阿里云 OSS, 腾讯云 COS
 */

import { signS3Request, createPresignedUrl } from "./sigv4.js";
import type {
  S3ClientConfig,
  PutObjectOptions,
  PutObjectResult,
  GetObjectOptions,
  HeadObjectResult,
  ListObjectsOptions,
  ListObjectsResult,
  PresignedUrlOptions,
  S3ObjectSummary,
} from "./types.js";

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
    let targetUrl: URL;

    if (this.forcePathStyle) {
      // Path-Style: https://endpoint/bucket/key
      const basePath = this.endpoint.pathname.replace(/\/+$/, "");
      const fullPath = `${basePath}/${this.bucket}${cleanKey ? "/" + cleanKey : ""}`;
      targetUrl = new URL(fullPath, this.endpoint.origin);
    } else {
      // Virtual-Hosted-Style: https://bucket.endpoint/key
      const host = `${this.bucket}.${this.endpoint.host}`;
      targetUrl = new URL(`${this.endpoint.protocol}//${host}/${cleanKey}`);
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
      body: data,
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
}

/**
 * 工厂函数：创建 S3Client
 */
export function createS3Client(config: S3ClientConfig): S3Client {
  return new S3Client(config);
}
