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
 * RFC 3986 严格 URI 编码。
 *
 * ## 实现要点：必须按**字节**编码，不能按 UTF-16 码元逐字符编码
 *
 * 历史实现是 `for (let i = 0; i < input.length; i++) { encoder.encode(input[i]) }`。
 * JS 字符串按 UTF-16 存储，emoji 与生僻字（代理对）会在这里被**拆成两个孤立
 * 代理项**；`TextEncoder` 遇到孤立代理项会输出替换字符 `EF BF BD`（U+FFFD）。
 * 实测：
 *
 * ```
 * "报告.pdf"      → %E6%8A%A5%E5%91%8A.pdf   正确（BMP 内字符不受影响）
 * "😀.png"        → %EF%BF%BD%EF%BF%BD.png   错误，应为 %F0%9F%98%80.png
 * ```
 *
 * 后果是：含 emoji / 生僻字的备份文件名，其**签名基于一个值、实际请求路径却是
 * 另一个值** → `SignatureDoesNotMatch`；或预签名 URL 指向一个不存在的对象。
 *
 * 正确做法是对整串先做 UTF-8 编码，再逐字节百分号编码。
 *
 * @param input 待编码字符串
 * @param encodeSlash 为 false 时保留 `/` 不编码（用于 canonical path）
 */
export function uriEncode(input: string, encodeSlash = true): string {
  // 未转义字符（RFC 3986 unreserved）：A-Z a-z 0-9 - _ . ~
  const UNRESERVED = /[A-Za-z0-9\-_.~]/;
  const SLASH = "/";

  let out = "";
  // 关键：一次编码整串，代理对不会被拆开
  const bytes = encoder.encode(input);
  for (const b of bytes) {
    const ch = String.fromCharCode(b);
    if (UNRESERVED.test(ch)) {
      out += ch;
    } else if (ch === SLASH && !encodeSlash) {
      out += SLASH;
    } else {
      out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return out;
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
 * 计算 SHA-256 哈希值 (Hex)。
 *
 * 权威实现在 `@nuln/worker-kit/crypto`；本模块此前持有第二份实现，
 * 根 barrel 平铺导出时会产生重复成员。现仅再导出。
 */
import { sha256Hex } from "../crypto/index.js";
export { sha256Hex };

/**
 * 计算 HMAC-SHA256
 */
export async function hmacSha256(
  key: Uint8Array | ArrayBuffer,
  data: string | Uint8Array
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as any,
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
