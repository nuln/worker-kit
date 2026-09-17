/**
 * RFC 7807 Problem Details & Standard Error Codes
 *
 * 统一微服务结构化错误与 RFC 7807 规范契约
 */

export enum NulnErrorCode {
  BAD_REQUEST = "ERR_BAD_REQUEST",
  UNAUTHORIZED = "ERR_UNAUTHORIZED",
  FORBIDDEN = "ERR_FORBIDDEN",
  NOT_FOUND = "ERR_NOT_FOUND",
  METHOD_NOT_ALLOWED = "ERR_METHOD_NOT_ALLOWED",
  CONFLICT = "ERR_CONFLICT",
  RATE_LIMITED = "ERR_RATE_LIMITED",
  UNPROCESSABLE_ENTITY = "ERR_UNPROCESSABLE_ENTITY",
  INTERNAL_ERROR = "ERR_INTERNAL_ERROR",
  SERVICE_UNAVAILABLE = "ERR_SERVICE_UNAVAILABLE",
  GATEWAY_TIMEOUT = "ERR_GATEWAY_TIMEOUT",
}

export interface ProblemDetailsOptions {
  /** HTTP 状态码 */
  status: number;
  /** 错误简述 (Title) */
  title: string;
  /** 详细错误信息 (Detail) */
  detail?: string;
  /** 错误分类 URI 或文档链接 */
  type?: string;
  /** 当前请求发生错误的实例 URI */
  instance?: string;
  /** 标准错误码 */
  code?: NulnErrorCode | string;
  /** 字段级表单校验失败详情 */
  invalidParams?: Array<{ name: string; reason: string }>;
  /** 其他自定义上下文字段 */
  extra?: Record<string, unknown>;
}

/**
 * 构造符合 RFC 7807 规范且向后兼容标准微服务格式的错误响应
 */
export function problemDetailsResponse(
  options: ProblemDetailsOptions,
  headers: HeadersInit = {}
): Response {
  const {
    status,
    title,
    detail,
    type = "about:blank",
    instance,
    code = `HTTP_${status}`,
    invalidParams,
    extra = {},
  } = options;

  const body = {
    ok: false,
    error: detail || title,
    status,
    title,
    detail: detail || title,
    type,
    code,
    ...(instance ? { instance } : {}),
    ...(invalidParams && invalidParams.length > 0 ? { "invalid-params": invalidParams } : {}),
    ...extra,
  };

  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/problem+json; charset=utf-8");

  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}
