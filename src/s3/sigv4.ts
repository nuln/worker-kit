/**
 * @nuln/worker-kit/s3/sigv4
 *
 * 纯 Web Crypto API 实现的 AWS Signature Version 4 (SigV4) 签名引擎
 * 零外部依赖，毫秒级计算，全兼容 AWS S3, Cloudflare R2, MinIO, Wasabi, B2, OSS, COS
 */

export interface SigV4SignOptions {
  method: string;
  url: URL;
  headers?: Record<string, string>;
  body?: string | Uint8Array | ArrayBuffer;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  service?: string;
  datetime?: Date;
}

export interface PresignedUrlSigV4Options {
  method?: string;
  url: URL;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  service?: string;
  expiresIn?: number;
  datetime?: Date;
}

const encoder = new TextEncoder();

/**
 * RFC 3986 严格 URI 编码
 */
export function uriEncode(input: string, encodeSlash = true): string {
  const result: string[] = [];
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (
      (ch >= "A" && ch <= "Z") ||
      (ch >= "a" && ch <= "z") ||
      (ch >= "0" && ch <= "9") ||
      ch === "_" ||
      ch === "-" ||
      ch === "~" ||
      ch === "."
    ) {
      result.push(ch);
    } else if (ch === "/" && !encodeSlash) {
      result.push("/");
    } else {
      const bytes = encoder.encode(ch);
      for (const b of bytes) {
        result.push("%" + b.toString(16).toUpperCase().padStart(2, "0"));
      }
    }
  }
  return result.join("");
}

export const rfc3986Encode = uriEncode;

/**
 * 将 ArrayBuffer 转为 Hex 小写字符串
 */
export function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * 计算 SHA-256 哈希值 (Hex)
 */
export async function sha256Hex(data: string | Uint8Array | ArrayBuffer = ""): Promise<string> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as any);
  return bufferToHex(digest);
}

/**
 * 计算 HMAC-SHA256
 */
export async function hmacSha256(
  key: Uint8Array | ArrayBuffer,
  data: string | Uint8Array
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const dataBytes = typeof data === "string" ? encoder.encode(data) : data;
  return await crypto.subtle.sign("HMAC", cryptoKey, dataBytes as any);
}

/**
 * 4 步派生 SigV4 最终签名密钥 (Signing Key)
 */
export async function getSignatureKey(
  key: string,
  dateStamp: string,
  regionName: string,
  serviceName: string
): Promise<ArrayBuffer> {
  const kSecret = encoder.encode("AWS4" + key);
  const kDate = await hmacSha256(kSecret, dateStamp);
  const kRegion = await hmacSha256(kDate, regionName);
  const kService = await hmacSha256(kRegion, serviceName);
  return await hmacSha256(kService, "aws4_request");
}

/**
 * 格式化 ISO8601 日期时间字符串
 */
export function formatSigV4Dates(date: Date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDateTime: iso,                     // YYYYMMDDTHHMMSSZ
    dateStamp: iso.substring(0, 8),      // YYYYMMDD
  };
}

/**
 * 计算标准 S3 HTTP 请求的 SigV4 认证签名与请求头
 */
export async function signS3Request(options: SigV4SignOptions): Promise<{ headers: Headers; url: URL }> {
  const {
    method,
    url,
    body = "",
    accessKeyId,
    secretAccessKey,
    sessionToken,
    region,
    service = "s3",
    datetime = new Date(),
  } = options;

  const { amzDateTime, dateStamp } = formatSigV4Dates(datetime);
  const payloadHash = await sha256Hex(body);

  const signedHeadersMap: Record<string, string> = {
    host: url.host,
    "x-amz-date": amzDateTime,
    "x-amz-content-sha256": payloadHash,
  };

  if (sessionToken) {
    signedHeadersMap["x-amz-security-token"] = sessionToken;
  }

  // 合并用户自定义请求头
  if (options.headers) {
    for (const [k, v] of Object.entries(options.headers)) {
      signedHeadersMap[k.toLowerCase()] = v.trim();
    }
  }

  // 1. 构建 Canonical Headers 与 Signed Headers 列表
  const sortedHeaderKeys = Object.keys(signedHeadersMap).sort();
  const canonicalHeaders = sortedHeaderKeys
    .map((k) => `${k}:${signedHeadersMap[k]}\n`)
    .join("");
  const signedHeaders = sortedHeaderKeys.join(";");

  // 2. 构建 Canonical Query String
  const queryParams: Array<[string, string]> = [];
  url.searchParams.forEach((v, k) => {
    queryParams.push([uriEncode(k, true), uriEncode(v, true)]);
  });
  queryParams.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  const canonicalQuery = queryParams.map(([k, v]) => `${k}=${v}`).join("&");

  // 3. 构建 Canonical URI
  const canonicalUri = uriEncode(url.pathname, false) || "/";

  // 4. 构建 Canonical Request
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const canonicalRequestHash = await sha256Hex(canonicalRequest);

  // 5. 构建 String to Sign
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDateTime,
    credentialScope,
    canonicalRequestHash,
  ].join("\n");

  // 6. 计算最终签名
  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signatureBuffer = await hmacSha256(signingKey, stringToSign);
  const signature = bufferToHex(signatureBuffer);

  // 7. 组装 Authorization 请求头
  const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers = new Headers();
  for (const [k, v] of Object.entries(signedHeadersMap)) {
    headers.set(k, v);
  }
  headers.set("authorization", authorizationHeader);

  return { headers, url };
}

/**
 * 生成带 SigV4 查询参数的预签名 URL (Presigned URL)
 */
export async function createPresignedUrl(options: PresignedUrlSigV4Options): Promise<string> {
  const {
    method = "GET",
    url: inputUrl,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    region,
    service = "s3",
    expiresIn = 3600,
    datetime = new Date(),
  } = options;

  const url = new URL(inputUrl.toString());
  const { amzDateTime, dateStamp } = formatSigV4Dates(datetime);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  url.searchParams.set("X-Amz-Credential", `${accessKeyId}/${credentialScope}`);
  url.searchParams.set("X-Amz-Date", amzDateTime);
  url.searchParams.set("X-Amz-Expires", String(expiresIn));
  url.searchParams.set("X-Amz-SignedHeaders", "host");

  if (sessionToken) {
    url.searchParams.set("X-Amz-Security-Token", sessionToken);
  }

  // Canonical Headers 只包含 host
  const canonicalHeaders = `host:${url.host}\n`;
  const signedHeaders = "host";

  // Canonical Query String
  const queryParams: Array<[string, string]> = [];
  url.searchParams.forEach((v, k) => {
    queryParams.push([uriEncode(k, true), uriEncode(v, true)]);
  });
  queryParams.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  const canonicalQuery = queryParams.map(([k, v]) => `${k}=${v}`).join("&");

  const canonicalUri = uriEncode(url.pathname, false) || "/";
  const payloadHash = "UNSIGNED-PAYLOAD";

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const canonicalRequestHash = await sha256Hex(canonicalRequest);

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDateTime,
    credentialScope,
    canonicalRequestHash,
  ].join("\n");

  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signatureBuffer = await hmacSha256(signingKey, stringToSign);
  const signature = bufferToHex(signatureBuffer);

  url.searchParams.set("X-Amz-Signature", signature);
  return url.toString();
}
