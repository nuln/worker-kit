/**
 * Request ID & Distributed Tracing Middleware
 *
 * 全链路分布式追踪与请求标识透传中间件
 */

export interface RequestIdOptions {
  /** 允许接收或输出的请求头名称，默认为 "X-Request-ID" */
  headerName?: string;
  /** 可选的 Traceparent 请求头名称，默认为 "traceparent" */
  traceHeaderName?: string;
  /** 自定义 ID 生成器，默认生成标准 UUIDv4 */
  generator?: () => string;
}

function defaultGenerator(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "req-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * 创建全链路 Request ID 中间件 (兼容 Hono 及通用中间件链)
 */
export function requestIdMiddleware(options: RequestIdOptions = {}) {
  const headerName = options.headerName || "X-Request-ID";
  const traceHeaderName = options.traceHeaderName || "traceparent";
  const generator = options.generator || defaultGenerator;

  return async (c: any, next: () => Promise<void>): Promise<void> => {
    // 1. 优先从请求头提取已有的 Request ID 或 traceparent
    let reqId = "";
    if (typeof c.req?.header === "function") {
      reqId = c.req.header(headerName) || c.req.header(headerName.toLowerCase()) || "";
      if (!reqId) {
        reqId = c.req.header(traceHeaderName) || "";
      }
    } else if (c.req?.headers?.get) {
      reqId = c.req.headers.get(headerName) || c.req.headers.get(headerName.toLowerCase()) || "";
      if (!reqId) {
        reqId = c.req.headers.get(traceHeaderName) || "";
      }
    }

    // 2. 无追踪标识时，边缘自动生成
    if (!reqId) {
      reqId = generator();
    }

    // 3. 注入上下文
    if (typeof c.set === "function") {
      c.set("requestId", reqId);
    }

    // 4. 执行后续中间件与路由处理器
    await next();

    // 5. 自动向响应头回写 Request ID
    if (c.res?.headers && typeof c.res.headers.set === "function") {
      c.res.headers.set(headerName, reqId);
    }
  };
}

/**
 * 辅助函数：创建自动携带当前 Request ID 的下游 fetch 客户端
 */
export function createTracedFetch(c: any, headerName = "X-Request-ID") {
  const reqId = (typeof c?.get === "function" ? c.get("requestId") : "") || "";
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    if (reqId && !headers.has(headerName)) {
      headers.set(headerName, reqId);
    }
    return fetch(input, { ...init, headers });
  };
}
