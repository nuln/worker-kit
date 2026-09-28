/**
 * @nuln/worker-kit/s3/types
 *
 * S3 协议跨云存储类型定义与提供商预设
 */

export type S3ProviderType =
  | "r2"       // Cloudflare R2
  | "aws"      // Amazon Web Services S3
  | "minio"    // MinIO / 本地开发 / 自建 S3
  | "wasabi"   // Wasabi Hot Cloud Storage
  | "b2"       // Backblaze B2 S3 API
  | "oss"      // 阿里云 OSS (S3 兼容模式)
  | "cos"      // 腾讯云 COS (S3 兼容模式)
  | "custom";  // 自定义 S3 兼容服务端点

export interface S3ClientConfig {
  /** 存储服务接入点，如 https://xxx.r2.cloudflarestorage.com 或 http://127.0.0.1:9000 */
  endpoint: string;
  /** 存储桶名称 */
  bucket: string;
  /** 访问凭据 Access Key ID */
  accessKeyId: string;
  /** 访问凭据 Secret Access Key */
  secretAccessKey: string;
  /** 可选的 Session Token (临时凭证 STS) */
  sessionToken?: string;
  /** 区域标识，AWS/Wasabi 等需指定 (如 "us-east-1", "ap-northeast-1")，R2/MinIO 默认为 "auto" 或 "us-east-1" */
  region?: string;
  /** 提供商类型，默认 "custom"，可自动推导部分厂商特性 */
  provider?: S3ProviderType;
  /** 是否强制使用 Path-Style 寻址 (如 https://endpoint/bucket/key)。MinIO 与 IP 端点默认为 true */
  forcePathStyle?: boolean;
}

export interface PutObjectOptions {
  /** 文件 MIME 类型，如 "application/json", "application/octet-stream" */
  contentType?: string;
  /** 自定义元数据 (x-amz-meta-*) */
  metadata?: Record<string, string>;
  /** 缓存控制 Cache-Control */
  cacheControl?: string;
  /** 内容处置 Content-Disposition */
  contentDisposition?: string;
}

export interface PutObjectResult {
  etag?: string;
  versionId?: string;
}

export interface GetObjectOptions {
  /** Range 请求分片，如 "bytes=0-1024" */
  range?: string;
}

export interface HeadObjectResult {
  exists: boolean;
  size?: number;
  contentType?: string;
  lastModified?: string;
  etag?: string;
  metadata?: Record<string, string>;
}

export interface S3ObjectSummary {
  key: string;
  size: number;
  lastModified: string;
  etag: string;
}

export interface ListObjectsOptions {
  /** 查找前缀 */
  prefix?: string;
  /** 分割符，通常为 "/" */
  delimiter?: string;
  /** 最大返回数量，默认 1000 */
  maxKeys?: number;
  /** 分页 ContinuationToken */
  continuationToken?: string;
}

export interface ListObjectsResult {
  objects: S3ObjectSummary[];
  commonPrefixes: string[];
  isTruncated: boolean;
  nextContinuationToken?: string;
  keyCount: number;
}

export interface PresignedUrlOptions {
  /** HTTP 请求方法，默认为 "GET"，上传则为 "PUT" */
  method?: "GET" | "PUT" | "HEAD";
  /** 签名有效期 (秒)，默认 3600 (1小时)，最大 604800 (7天) */
  expiresIn?: number;
}

/* ==================================================== 分块上传 (Multipart) */

/**
 * 单个分片的标识。
 *
 * S3 的 CompleteMultipartUpload **要求**按 partNumber 升序提交，
 * 且数量 1~10000。顺序错了会返回 400 `InvalidPartOrder`。
 */
export interface UploadedPart {
  /** 分片序号，从 1 开始 */
  partNumber: number;
  /** 该分片的 ETag（**必须带引号**，`complete` 时原样回传） */
  eTag: string;
}

/** 分块上传的参数（元数据只在 create 时指定，后续分片不再携带） */
export type CreateMultipartOptions = PutObjectOptions;

/** 分块上传完成后的对象信息 */
export interface CompletedMultipartResult {
  key: string;
  /** S3 为整体对象计算的 ETag，形如 `"<md5>-<partCount>"`（分块数 > 1 时） */
  etag?: string;
  versionId?: string;
  /** 实际提交的分片数 */
  partCount: number;
  /** 对象总字节数（由各分片累加得出） */
  size: number;
}

/** S3 协议硬性限制：除最后一片外，每片不得小于 5MB */
export const MIN_PART_SIZE = 5 * 1024 * 1024;
/** S3 协议硬性限制：单次分块上传最多 10000 片 */
export const MAX_PARTS = 10_000;

/** 分块上传的辅助配置 */
export interface UploadMultipartOptions extends CreateMultipartOptions {
  /**
   * 分片大小（字节）。默认 {@link MIN_PART_SIZE}。
   *
   * 必须 ≥ 5MB 且 5MB 的整数倍（S3 对非末片的要求），
   * 否则服务端返回 400 `EntityTooSmall`。
   */
  partSize?: number;
  /**
   * 并发上传的分片数，默认 4。
   *
   * 太大会在 Worker 上耗尽并发额度（Cloudflare 单请求 6 个子请求），
   * 太小则网络往返成为瓶颈。4 是个保守起点。
   */
  concurrency?: number;
  /**
   * 单分片失败时的重试次数，默认 2。
   *
   * 只对分片生效：整包重传代价太大（已经传完的部分要全部重来）。
   */
  retriesPerPart?: number;
  /**
   * 进度回调。每完成一片调用一次。
   *
   * 用途：让调用方能展示进度 / 触发告警。回调抛错会被吞掉 ——
   * 进度上报不该影响上传本身。
   */
  onProgress?: (progress: {
    uploadedParts: number;
    totalParts: number;
    uploadedBytes: number;
    totalBytes: number;
  }) => void;
}
