/**
 * @nuln/worker-kit/observability/health
 *
 * 统一标准微服务健康探针与就绪状态检测器
 */

export interface HealthCheckOptions<E = any> {
  serviceName: string;
  version?: string;
  statusText?: string;
  checks?: {
    d1?: (env: E) => Promise<boolean> | boolean;
    kv?: (env: E) => Promise<boolean> | boolean;
    r2?: (env: E) => Promise<boolean> | boolean;
    custom?: Record<string, (env: E) => Promise<boolean> | boolean>;
  };
}

export interface HealthCheckResult {
  code?: number;
  message?: string;
  ok: boolean;
  status: "healthy" | "degraded";
  service: string;
  version: string;
  latency: Record<string, number>;
  data: {
    service: string;
    version: string;
    status: "ok" | "healthy" | "degraded" | string;
    latency: Record<string, number>;
    timestamp: number;
  };
  errors?: Record<string, string>;
  timestamp: number;
}

/**
 * 默认 D1 健康检测器
 */
export async function defaultD1Check(db?: any): Promise<boolean> {
  if (!db || typeof db.prepare !== "function") return false;
  try {
    await db.prepare("SELECT 1").first();
    return true;
  } catch {
    return false;
  }
}

/**
 * 默认 KV 健康检测器
 */
export async function defaultKvCheck(kv?: any): Promise<boolean> {
  if (!kv || typeof kv.get !== "function") return false;
  try {
    await kv.get("__health_probe_non_existent__");
    return true;
  } catch {
    return false;
  }
}

/**
 * 创建统一标准的健康检查路由处理器
 */
export function createHealthCheckHandler<E = any>(options: HealthCheckOptions<E>) {
  return async (request: Request, env: E): Promise<Response> => {
    const start = Date.now();
    const latencies: Record<string, number> = {};
    const errors: Record<string, string> = {};
    let isHealthy = true;

    // 1. D1 检查
    if (options.checks?.d1) {
      const d1Start = Date.now();
      try {
        const ok = await options.checks.d1(env);
        latencies.d1 = Date.now() - d1Start;
        if (!ok) {
          isHealthy = false;
          errors.d1 = "D1 check returned false";
        }
      } catch (err: any) {
        latencies.d1 = Date.now() - d1Start;
        isHealthy = false;
        errors.d1 = err?.message || String(err);
      }
    } else if ((env as any)?.DB) {
      const d1Start = Date.now();
      try {
        const ok = await defaultD1Check((env as any).DB);
        latencies.d1 = Date.now() - d1Start;
        if (!ok) {
          isHealthy = false;
          errors.d1 = "D1 ping query failed";
        }
      } catch (err: any) {
        latencies.d1 = Date.now() - d1Start;
        isHealthy = false;
        errors.d1 = err?.message || String(err);
      }
    }

    // 2. KV 检查
    if (options.checks?.kv) {
      const kvStart = Date.now();
      try {
        const ok = await options.checks.kv(env);
        latencies.kv = Date.now() - kvStart;
        if (!ok) {
          isHealthy = false;
          errors.kv = "KV check returned false";
        }
      } catch (err: any) {
        latencies.kv = Date.now() - kvStart;
        isHealthy = false;
        errors.kv = err?.message || String(err);
      }
    }

    // 3. R2 检查
    if (options.checks?.r2) {
      const r2Start = Date.now();
      try {
        const ok = await options.checks.r2(env);
        latencies.r2 = Date.now() - r2Start;
        if (!ok) {
          isHealthy = false;
          errors.r2 = "R2 check returned false";
        }
      } catch (err: any) {
        latencies.r2 = Date.now() - r2Start;
        isHealthy = false;
        errors.r2 = err?.message || String(err);
      }
    }

    // 4. 自定义检查
    if (options.checks?.custom) {
      for (const [key, checkFn] of Object.entries(options.checks.custom)) {
        const customStart = Date.now();
        try {
          const ok = await checkFn(env);
          latencies[key] = Date.now() - customStart;
          if (!ok) {
            isHealthy = false;
            errors[key] = `${key} check returned false`;
          }
        } catch (err: any) {
          latencies[key] = Date.now() - customStart;
          isHealthy = false;
          errors[key] = err?.message || String(err);
        }
      }
    }

    latencies.total = Date.now() - start;

    const result: HealthCheckResult = {
      code: isHealthy ? 0 : 503,
      message: isHealthy ? "OK" : "Degraded",
      ok: isHealthy,
      status: isHealthy ? "healthy" : "degraded",
      service: options.serviceName,
      version: options.version || "0.1.0",
      latency: latencies,
      data: {
        service: options.serviceName,
        version: options.version || "0.1.0",
        status: isHealthy
          ? (options.statusText || (options.serviceName.toLowerCase() === "mail" ? "ok" : "healthy"))
          : "degraded",
        latency: latencies,
        timestamp: Math.floor(Date.now() / 1000),
      },
      timestamp: Date.now(),
    };

    if (!isHealthy) {
      result.errors = errors;
    }

    return new Response(JSON.stringify(result, null, 2), {
      status: isHealthy ? 200 : 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, no-cache, must-revalidate",
      },
    });
  };
}
