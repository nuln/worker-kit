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
