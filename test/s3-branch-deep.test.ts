import { describe, it, expect, vi } from "vitest";
import { S3Client, createS3Client } from "../src/s3/index.js";

describe("S3 Module - Deep Branch Coverage", () => {
  it("covers S3Client custom region, endpoints, and deleteObject", async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async (url: any, init: any) => {
      if (init.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return new Response("ok", { status: 200 });
    });
    globalThis.fetch = fetchSpy as any;

    try {
      // Wasabi provider
      const wasabiClient = createS3Client({
        provider: "wasabi",
        endpoint: "https://s3.wasabisys.com",
        accessKeyId: "wasabi_key",
        secretAccessKey: "wasabi_secret",
        bucket: "my-wasabi-bucket",
        region: "us-east-1",
      });

      await wasabiClient.deleteObject("obsolete-file.txt");
      expect(fetchSpy).toHaveBeenCalled();
      const lastCall = fetchSpy.mock.calls[0];
      expect(lastCall[1].method).toBe("DELETE");

      // Tencent COS provider
      const cosClient = new S3Client({
        provider: "cos",
        endpoint: "https://cos.ap-guangzhou.myqcloud.com",
        accessKeyId: "cos_key",
        secretAccessKey: "cos_secret",
        bucket: "cos-bucket-1250000000",
        region: "ap-guangzhou",
      });
      expect(cosClient.bucket).toBe("cos-bucket-1250000000");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles S3 error responses with XML error details gracefully", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        `<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>`,
        { status: 404, headers: { "Content-Type": "application/xml" } }
      );
    }) as any;

    try {
      const client = new S3Client({
        provider: "aws",
        endpoint: "https://s3.amazonaws.com",
        accessKeyId: "key",
        secretAccessKey: "secret",
        bucket: "my-bucket",
      });

      await expect(client.getObject("missing.txt")).rejects.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
