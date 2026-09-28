import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { S3Client, createS3Client } from "../../src/s3/index.js";

describe("[E2E Example] 01 - S3 Multi-Cloud Object Storage Lifecycle", () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("executes complete upload, read, head, list, presign, and delete lifecycle", async () => {
    // 1. Initialize S3 client for Cloudflare R2
    const s3 = createS3Client({
      endpoint: "https://r2-account-id.r2.cloudflarestorage.com",
      bucket: "production-assets",
      accessKeyId: "r2_access_key",
      secretAccessKey: "r2_secret_key",
      provider: "r2",
    });

    expect(s3.region).toBe("auto");
    expect(s3.forcePathStyle).toBe(true);

    // 2. Put Object (Upload JSON bundle)
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { etag: '"hash_etag_001"', "x-amz-version-id": "v1" },
      })
    );

    const putRes = await s3.putObject("avatars/user_1.json", JSON.stringify({ name: "Alice", active: true }), {
      contentType: "application/json",
      metadata: { author: "Alice", env: "production" },
    });
    expect(putRes.etag).toBe("hash_etag_001");

    // 3. Head Object (Check existence and metadata)
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: {
          "content-length": "36",
          "content-type": "application/json",
          "x-amz-meta-author": "Alice",
          etag: '"hash_etag_001"',
        },
      })
    );

    const headRes = await s3.headObject("avatars/user_1.json");
    expect(headRes.exists).toBe(true);
    expect(headRes.size).toBe(36);
    expect(headRes.metadata?.author).toBe("Alice");

    // 4. Get Object
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ name: "Alice", active: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const getRes = await s3.getObject("avatars/user_1.json");
    expect(getRes.status).toBe(200);
    const downloaded = (await getRes.json()) as any;
    expect(downloaded.name).toBe("Alice");

    // 5. List Objects
    const listXml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Name>production-assets</Name>
  <Prefix>avatars/</Prefix>
  <KeyCount>1</KeyCount>
  <Contents>
    <Key>avatars/user_1.json</Key>
    <Size>36</Size>
    <ETag>&quot;hash_etag_001&quot;</ETag>
  </Contents>
</ListBucketResult>`;
    mockFetch.mockResolvedValueOnce(new Response(listXml, { status: 200 }));

    const listRes = await s3.listObjects({ prefix: "avatars/" });
    expect(listRes.keyCount).toBe(1);
    expect(listRes.objects[0].key).toBe("avatars/user_1.json");

    // 6. Generate Presigned URL for public download
    const presignedUrl = await s3.getPresignedUrl("avatars/user_1.json", { expiresIn: 3600 });
    expect(presignedUrl).toContain("X-Amz-Signature");
    expect(presignedUrl).toContain("avatars/user_1.json");

    // 7. Delete Object
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(s3.deleteObject("avatars/user_1.json")).resolves.toBeUndefined();
  });
});
