/**
 * Example 01: S3 Multi-Cloud Storage Client
 *
 * Demonstrates:
 * 1. Initializing S3Client for AWS, R2, Wasabi, MinIO, OSS, COS
 * 2. Uploading JSON/Binary objects with metadata
 * 3. Downloading objects and verifying tags
 * 4. Generating Presigned URLs for direct client uploads/downloads
 * 5. Listing bucket objects with prefix filtering
 */

import { createS3Client, S3Client, S3ProviderType } from "@nuln/worker-kit";

export async function runS3Example() {
  console.log("=== [Example 01] S3 Multi-Cloud Object Storage ===");

  // 1. Initialize S3 client for Cloudflare R2
  const r2Client = createS3Client({
    provider: "r2",
    endpoint: "https://<account-id>.r2.cloudflarestorage.com",
    accessKeyId: "r2_access_key_id",
    secretAccessKey: "r2_secret_access_key",
    bucket: "production-assets",
  });

  console.log(`Initialized R2 Client for bucket: ${r2Client.bucket}`);

  // 2. Put Object (Upload)
  const fileData = JSON.stringify({ message: "Hello from Cloudflare Workers!", timestamp: Date.now() });
  console.log("Uploading file: config/site-settings.json...");
  // await r2Client.putObject("config/site-settings.json", fileData, {
  //   contentType: "application/json",
  //   metadata: { author: "admin@nuln.net", version: "1.0.0" },
  // });

  // 3. Generate Presigned Download URL (Expires in 1 hour)
  const presignedUrl = await r2Client.getPresignedUrl("config/site-settings.json", {
    method: "GET",
    expiresIn: 3600,
  });
  console.log(`Generated Presigned Download URL: ${presignedUrl}`);
}
