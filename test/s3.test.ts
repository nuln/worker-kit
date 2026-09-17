import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { S3Client, createS3Client } from "../src/s3/client.js";
import { signS3Request, createPresignedUrl, rfc3986Encode, sha256Hex, hmacSha256 } from "../src/s3/sigv4.js";

describe("@nuln/worker-kit/s3 - SigV4 & Utilities", () => {
  it("rfc3986Encode properly encodes characters", () => {
    expect(rfc3986Encode("hello world")).toBe("hello%20world");
    expect(rfc3986Encode("a+b=c&d*e~f_g-h.i")).toBe("a%2Bb%3Dc%26d%2Ae~f_g-h.i");
    expect(rfc3986Encode("/path/to/key.json", false)).toBe("/path/to/key.json");
    expect(rfc3986Encode("/path/to/key.json", true)).toBe("%2Fpath%2Fto%2Fkey.json");
  });

  it("sha256Hex computes correct hash", async () => {
    const hash = await sha256Hex("test payload");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBe(64);
    const emptyHash = await sha256Hex("");
    expect(emptyHash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("hmacSha256 computes valid buffer", async () => {
    const key = new TextEncoder().encode("secret-key");
    const result = await hmacSha256(key, "data-to-sign");
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBe(32);
  });

  it("signS3Request generates Authorization header with AWS4-HMAC-SHA256", async () => {
    const url = new URL("https://my-bucket.s3.us-west-2.amazonaws.com/test.txt?query=param");
    const res = await signS3Request({
      method: "PUT",
      url,
      headers: { "content-type": "text/plain" },
      body: "hello world",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-west-2",
      service: "s3",
    });

    const auth = res.headers.get("authorization");
    expect(auth).toBeDefined();
    expect(auth).toContain("AWS4-HMAC-SHA256");
    expect(auth).toContain("Credential=AKIAIOSFODNN7EXAMPLE/");
    expect(auth).toContain("/us-west-2/s3/aws4_request");
    expect(auth).toContain("SignedHeaders=");
    expect(auth).toContain("Signature=");
    expect(res.headers.get("x-amz-date")).toBeDefined();
    expect(res.headers.get("x-amz-content-sha256")).toBeDefined();
  });

  it("signS3Request includes x-amz-security-token when sessionToken provided", async () => {
    const url = new URL("https://my-bucket.s3.us-west-2.amazonaws.com/test.txt");
    const res = await signS3Request({
      method: "GET",
      url,
      headers: {},
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      sessionToken: "session-token-12345",
      region: "us-west-2",
    });

    expect(res.headers.get("x-amz-security-token")).toBe("session-token-12345");
  });

  it("createPresignedUrl creates valid URL with query parameters", async () => {
    const url = new URL("https://my-bucket.s3.us-west-2.amazonaws.com/test.txt");
    const presigned = await createPresignedUrl({
      method: "GET",
      url,
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-west-2",
      expiresIn: 7200,
    });

    const parsed = new URL(presigned);
    expect(parsed.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(parsed.searchParams.get("X-Amz-Credential")).toContain("AKIAIOSFODNN7EXAMPLE");
    expect(parsed.searchParams.get("X-Amz-Date")).toBeDefined();
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("7200");
    expect(parsed.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(parsed.searchParams.get("X-Amz-Signature")).toBeDefined();
  });
});

describe("@nuln/worker-kit/s3 - S3Client Multi-Cloud URL & Region Resolution", () => {
  it("throws on missing required constructor fields", () => {
    expect(() => new S3Client({} as any)).toThrow("endpoint is required");
    expect(() => new S3Client({ endpoint: "http://localhost" } as any)).toThrow("bucket is required");
    expect(() => new S3Client({ endpoint: "http://localhost", bucket: "b" } as any)).toThrow("accessKeyId is required");
    expect(
      () => new S3Client({ endpoint: "http://localhost", bucket: "b", accessKeyId: "ak" } as any)
    ).toThrow("secretAccessKey is required");
  });

  it("auto resolves region and forcePathStyle for Cloudflare R2", () => {
    const client = new S3Client({
      endpoint: "https://abc123456.r2.cloudflarestorage.com",
      bucket: "my-bucket",
      accessKeyId: "ak",
      secretAccessKey: "sk",
      provider: "r2",
    });

    expect(client.region).toBe("auto");
    expect(client.forcePathStyle).toBe(true);

    const url = client.resolveUrl("backup/file.json");
    expect(url.toString()).toBe("https://abc123456.r2.cloudflarestorage.com/my-bucket/backup/file.json");
  });

  it("auto resolves region and path style for MinIO / Local IP", () => {
    const client = new S3Client({
      endpoint: "http://127.0.0.1:9000",
      bucket: "local-bucket",
      accessKeyId: "ak",
      secretAccessKey: "sk",
      provider: "minio",
    });

    expect(client.region).toBe("us-east-1");
    expect(client.forcePathStyle).toBe(true);

    const url = client.resolveUrl("folder/item.txt");
    expect(url.toString()).toBe("http://127.0.0.1:9000/local-bucket/folder/item.txt");
  });

  it("auto extracts region for AWS S3 and uses virtual-hosted style", () => {
    const client = new S3Client({
      endpoint: "s3.eu-central-1.amazonaws.com",
      bucket: "aws-bucket",
      accessKeyId: "ak",
      secretAccessKey: "sk",
      provider: "aws",
    });

    expect(client.region).toBe("eu-central-1");
    expect(client.forcePathStyle).toBe(false);

    const url = client.resolveUrl("test.json");
    expect(url.toString()).toBe("https://aws-bucket.s3.eu-central-1.amazonaws.com/test.json");
  });

  it("auto extracts region for Wasabi", () => {
    const client = new S3Client({
      endpoint: "s3.us-east-2.wasabisys.com",
      bucket: "wasabi-bucket",
      accessKeyId: "ak",
      secretAccessKey: "sk",
      provider: "wasabi",
    });

    expect(client.region).toBe("us-east-2");
    expect(client.forcePathStyle).toBe(false);
  });

  it("auto extracts region for Backblaze B2", () => {
    const client = new S3Client({
      endpoint: "s3.us-west-002.backblazeb2.com",
      bucket: "b2-bucket",
      accessKeyId: "ak",
      secretAccessKey: "sk",
      provider: "b2",
    });

    expect(client.region).toBe("us-west-002");
  });

  it("auto extracts region for Aliyun OSS", () => {
    const client = new S3Client({
      endpoint: "oss-cn-hangzhou.aliyuncs.com",
      bucket: "oss-bucket",
      accessKeyId: "ak",
      secretAccessKey: "sk",
      provider: "oss",
    });

    expect(client.region).toBe("cn-hangzhou");
    const url = client.resolveUrl("dir/data.zip");
    expect(url.toString()).toBe("https://oss-bucket.oss-cn-hangzhou.aliyuncs.com/dir/data.zip");
  });

  it("auto extracts region for Tencent Cloud COS", () => {
    const client = new S3Client({
      endpoint: "cos.ap-shanghai.myqcloud.com",
      bucket: "cos-bucket",
      accessKeyId: "ak",
      secretAccessKey: "sk",
      provider: "cos",
    });

    expect(client.region).toBe("ap-shanghai");
    const url = client.resolveUrl("backup.tar");
    expect(url.toString()).toBe("https://cos-bucket.cos.ap-shanghai.myqcloud.com/backup.tar");
  });

  it("respects explicit region and forcePathStyle override", () => {
    const client = createS3Client({
      endpoint: "https://custom-s3.domain.com",
      bucket: "my-bucket",
      accessKeyId: "ak",
      secretAccessKey: "sk",
      region: "ap-southeast-1",
      forcePathStyle: true,
    });

    expect(client.region).toBe("ap-southeast-1");
    expect(client.forcePathStyle).toBe(true);
    expect(client.resolveUrl("abc.txt").toString()).toBe("https://custom-s3.domain.com/my-bucket/abc.txt");
  });
});

describe("@nuln/worker-kit/s3 - S3Client Operations with Mock Fetch", () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new S3Client({
    endpoint: "https://r2-endpoint.r2.cloudflarestorage.com",
    bucket: "test-bucket",
    accessKeyId: "test-ak",
    secretAccessKey: "test-sk",
    provider: "r2",
  });

  it("putObject uploads data successfully and extracts etag and versionId", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: {
          etag: '"1234567890abcdef"',
          "x-amz-version-id": "v-001",
        },
      })
    );

    const res = await client.putObject("key1.json", '{"hello":"world"}', {
      contentType: "application/json",
      cacheControl: "max-age=3600",
      contentDisposition: "attachment; filename=key1.json",
      metadata: { service: "tower", env: "prod" },
    });

    expect(res.etag).toBe("1234567890abcdef");
    expect(res.versionId).toBe("v-001");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const call = mockFetch.mock.calls[0];
    expect(call[1].method).toBe("PUT");
    expect(call[1].headers.get("content-type")).toBe("application/json");
    expect(call[1].headers.get("cache-control")).toBe("max-age=3600");
    expect(call[1].headers.get("content-disposition")).toBe("attachment; filename=key1.json");
    expect(call[1].headers.get("x-amz-meta-service")).toBe("tower");
    expect(call[1].headers.get("x-amz-meta-env")).toBe("prod");
  });

  it("putObject throws descriptive error on non-ok status", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("<Error><Message>Access Denied</Message></Error>", {
        status: 403,
        statusText: "Forbidden",
      })
    );

    await expect(client.putObject("secret.txt", "data")).rejects.toThrow("S3Client.putObject failed [403]");
  });

  it("getObject sends request and handles range header", async () => {
    mockFetch.mockResolvedValueOnce(new Response("partial data", { status: 206 }));

    const res = await client.getObject("large.bin", { range: "bytes=0-100" });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe("partial data");

    const call = mockFetch.mock.calls[0];
    expect(call[1].headers.get("range")).toBe("bytes=0-100");
  });

  it("getObject throws on error status", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Not Found", { status: 404, statusText: "Not Found" }));

    await expect(client.getObject("missing.txt")).rejects.toThrow("S3Client.getObject failed [404]");
  });

  it("headObject returns metadata when object exists", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: {
          "content-length": "1024",
          "content-type": "application/json",
          "last-modified": "Wed, 21 Oct 2026 07:28:00 GMT",
          etag: '"etag123"',
          "x-amz-meta-app": "nuln-tower",
        },
      })
    );

    const res = await client.headObject("info.json");
    expect(res.exists).toBe(true);
    expect(res.size).toBe(1024);
    expect(res.contentType).toBe("application/json");
    expect(res.etag).toBe("etag123");
    expect(res.metadata?.app).toBe("nuln-tower");
  });

  it("headObject returns exists: false on 404 status", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));

    const res = await client.headObject("none.json");
    expect(res.exists).toBe(false);
  });

  it("deleteObject succeeds on 204 or 404", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(client.deleteObject("deleted.txt")).resolves.toBeUndefined();

    mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(client.deleteObject("nonexistent.txt")).resolves.toBeUndefined();
  });

  it("deleteObject throws on 500 error", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Internal error", { status: 500, statusText: "Internal Error" }));
    await expect(client.deleteObject("bad.txt")).rejects.toThrow("S3Client.deleteObject failed [500]");
  });

  it("listObjects parses XML response correctly", async () => {
    const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
    <Name>test-bucket</Name>
    <Prefix>backups/</Prefix>
    <KeyCount>2</KeyCount>
    <MaxKeys>1000</MaxKeys>
    <IsTruncated>false</IsTruncated>
    <Contents>
        <Key>backups/file1&amp;test.json</Key>
        <LastModified>2026-09-17T10:00:00.000Z</LastModified>
        <ETag>&quot;etag1&quot;</ETag>
        <Size>1234</Size>
    </Contents>
    <Contents>
        <Key>backups/file2.json</Key>
        <LastModified>2026-09-17T11:00:00.000Z</LastModified>
        <ETag>&quot;etag2&quot;</ETag>
        <Size>5678</Size>
    </Contents>
    <CommonPrefixes>
        <Prefix>backups/subfolder/</Prefix>
    </CommonPrefixes>
</ListBucketResult>`;

    mockFetch.mockResolvedValueOnce(new Response(xmlResponse, { status: 200 }));

    const res = await client.listObjects({ prefix: "backups/", delimiter: "/" });
    expect(res.isTruncated).toBe(false);
    expect(res.keyCount).toBe(2);
    expect(res.objects.length).toBe(2);
    expect(res.objects[0].key).toBe("backups/file1&test.json");
    expect(res.objects[0].size).toBe(1234);
    expect(res.objects[0].etag).toBe("etag1");
    expect(res.objects[1].key).toBe("backups/file2.json");
    expect(res.commonPrefixes).toEqual(["backups/subfolder/"]);
  });

  it("getPresignedUrl creates valid presigned url", async () => {
    const presigned = await client.getPresignedUrl("my-key.png", { expiresIn: 1800 });
    expect(presigned).toContain("X-Amz-Signature");
    expect(presigned).toContain("X-Amz-Expires=1800");
  });
});
