/**
 * D1 & Database Retry Mechanism with Exponential Backoff
 *
 * D1 数据库高并发与瞬时争用指数退避重试器
 */

export interface DbRetryOptions {
  /** 最大重试次数，默认 3 次 */
  maxRetries?: number;
  /** 初始退避基准时间 (毫秒)，默认 25ms */
  initialBackoffMs?: number;
  /** 最大退避时间上限 (毫秒)，默认 500ms */
  maxBackoffMs?: number;
  /** 自定义判断是否可重试的谓词函数 */
  isRetryable?: (error: any) => boolean;
}

/**
 * 默认可重试的 D1 / SQLite 错误特征
 */
export function defaultIsRetryableError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  return (
    msg.includes("sqlite_busy") ||
    msg.includes("database is locked") ||
    msg.includes("lock contention") ||
    msg.includes("d1_error") ||
    msg.includes("network connection reset") ||
    msg.includes("connection reset") ||
    msg.includes("failed to execute query")
  );
}

/**
 * 执行带随机抖动的指数退避重试
 *
 * @param fn 需要执行的异步数据库操作
 * @param options 重试参数配置
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  options: DbRetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialBackoff = options.initialBackoffMs ?? 25;
  const maxBackoff = options.maxBackoffMs ?? 500;
  const isRetryable = options.isRetryable ?? defaultIsRetryableError;

  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (attempt >= maxRetries || !isRetryable(err)) {
        throw err;
      }

      // 计算指数退避时间 + 随机抖动 (Jitter 0~50%)
      const expBackoff = Math.min(initialBackoff * Math.pow(2, attempt), maxBackoff);
      const jitter = expBackoff * (0.5 + Math.random() * 0.5);
      const delayMs = Math.floor(jitter);

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
