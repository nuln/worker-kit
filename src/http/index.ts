/**
 * @nuln/worker-kit/http
 *
 * 边缘 HTTP 响应辅助函数、路径归一化与 IP 提取工具
 */

export function jsonResponse(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

export function jsonError(
  status: number,
  message: string,
  code?: string,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse(
    {
      ok: false,
      error: message,
      code: code || `HTTP_${status}`,
      ...extra,
    },
    status,
  );
}

export function htmlResponse(html: string, status = 200, headers: HeadersInit = {}): Response {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...headers,
    },
  });
}

export function textResponse(status: number, text: string, headers: HeadersInit = {}): Response {
  return new Response(text, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...headers,
    },
  });
}

export function redirectResponse(location: string, status: 301 | 302 | 307 | 308 = 302): Response {
  return new Response(null, {
    status,
    headers: { Location: location },
  });
}

export function normalizeBasePath(basePath?: string | null): string {
  const clean = `/${String(basePath || "").trim()}`.replace(/\/+/g, "/").replace(/\/+$/, "");
  return clean === "/" ? "" : clean;
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "127.0.0.1"
  );
}

export function escapeHtml(str: string): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i] || "B"}`;
}

export function errorResponse(message: string, status = 400, details?: unknown): Response {
  return jsonResponse(
    {
      ok: false,
      error: message,
      ...(details !== undefined ? { details } : {}),
    },
    status,
  );
}

/** 统一标准 HTTP 安全响应头中间件（注入 nosniff, SAMEORIGIN, CSP, Referrer-Policy 等） */
export function applySecurityHeaders(headers: Headers): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

/** 通用健康检查响应处理器（返回标准外壳数据） */
export interface HealthInfo {
  service: string;
  version?: string;
  status?: string;
  extra?: Record<string, unknown>;
}

export function createHealthResponse(info: HealthInfo): Response {
  return jsonResponse({
    ok: true,
    data: {
      service: info.service,
      version: info.version || "1.0.0",
      status: info.status || "ok",
      timestamp: new Date().toISOString(),
      ...(info.extra || {}),
    },
  });
}

/** 解析客户端 IP、地理位置与客户端元数据 */
export interface ClientMeta {
  ip: string;
  country?: string;
  city?: string;
  asn?: number;
  isMobile: boolean;
  userAgent: string;
}

export function extractClientMeta(request: Request): ClientMeta {
  const ip = getClientIp(request);
  const ua = request.headers.get("User-Agent") || "";
  const cf = (request as any).cf;
  const isMobile = /mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua);
  return {
    ip,
    country: cf?.country,
    city: cf?.city,
    asn: cf?.asn,
    isMobile,
    userAgent: ua,
  };
}

/** 统一安全分页参数解析（默认 page=1, limit=20，上限 100） */
export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export function parsePaginationParams(query: Record<string, string | undefined>): PaginationParams {
  const page = Math.max(1, parseInt(query.page || "1", 10) || 1);
  const rawLimit = parseInt(query.limit || "20", 10) || 20;
  const limit = Math.min(100, Math.max(1, rawLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/** 流式文件下载/备份响应封装 */
export function createDataExportResponse(data: unknown, filename: string): Response {
  const jsonStr = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return new Response(jsonStr, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      "Cache-Control": "no-store",
    },
  });
}


