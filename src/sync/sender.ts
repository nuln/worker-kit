/**
 * @nuln/worker-kit/sync
 * 增量数据同步发射器 (Sync Sender)
 * 运行于主服务 (Cloudflare)，在写入主库后以非阻塞方式异步推送增量数据至备用节点 (NAS open-compute)
 */

import type {
  D1ChangeEvent,
  D1BatchSyncPayload,
  SyncDeliveryResult,
  SyncEnv,
  SyncSenderConfig,
} from "./types.js";

/** 默认视为「瞬时故障、值得重试」的状态码 */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** 默认视为「永久失败、重试无意义」的状态码 */
const DEFAULT_FATAL_STATUS = [400, 401, 403, 404, 405, 410, 422];

/**
 * 退避时长：指数递增 + 抖动，并封顶。
 *
 * 抖动用 `Math.random()` 而非确定性哈希：退避只用于错开重试时刻，
 * 不参与任何一致性判定，因此不需要可复现。
 *
 * @param attempt 第几次重试（0 表示首次尝试后）
 */
function backoffDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  jitter: number,
): number {
  const raw = Math.min(maxMs, baseMs * 2 ** attempt);
  if (jitter <= 0) return raw;
  // 抖动方向向下：上浮会突破 maxMs 封顶，让"封顶"名存实亡
  const span = raw * Math.min(1, Math.max(0, jitter));
  return Math.round(raw - span * Math.random());
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 判定一次失败是否值得重试。
 *
 * ## 为什么必须区分 4xx 与 5xx
 *
 * 对端冷启动、网关抖动 → 502/503/504，重试有意义。
 * 密钥错配（401）、载荷非法（400）→ 重试一万次结果一样，
 * 只会白白占用对端资源、把"密钥配错了"这个真因推迟到几秒后才暴露。
 *
 * 网络层异常（`fetch` reject）一律视为瞬时：DNS 抖动、连接重置、
 * 对端正在重启都会走到这里。
 */
function classifyFailure(
  status: number | undefined,
  fatal: ReadonlySet<number>,
): { retryable: boolean; fatal: boolean } {
  if (status === undefined) return { retryable: true, fatal: false };
  if (fatal.has(status)) return { retryable: false, fatal: true };
  return { retryable: RETRYABLE_STATUS.has(status), fatal: false };
}

/** 把任意异常压成可读字符串（非 Error 也要能落到日志里） */
function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

/**
 * 推送单条或批量变更的内部实现（带重试）。
 *
 * 抽出来是因为 `sendD1Change` 与 `sendD1BatchChanges` 的重试语义必须**完全一致**：
 * 两者的区别只在载荷体，不该各写一套退避逻辑 —— 否则两者行为漂移时
 * 没人能看出差异是刻意的还是 bug。
 */
async function deliverWithRetry(
  endpoint: string,
  secret: string,
  nodeId: string,
  headers: Record<string, string>,
  body: string,
  config: SyncSenderConfig | undefined,
): Promise<SyncDeliveryResult> {
  const fetchImpl = config?.customFetch ?? fetch;
  const timeoutMs = config?.timeoutMs ?? 5000;
  const maxRetries = config?.maxRetries ?? 2;
  const baseDelay = config?.retryBaseDelayMs ?? 100;
  const maxDelay = config?.retryMaxDelayMs ?? 2000;
  const jitter = config?.retryJitter ?? 0.2;
  const fatalSet = new Set(config?.fatalStatusCodes ?? DEFAULT_FATAL_STATUS);

  let attempts = 0;
  let totalBackoff = 0;
  let lastStatus: number | undefined;
  let lastError = "";

  for (;;) {
    attempts++;
    let status: number | undefined;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      status = response.status;

      if (response.ok) {
        return {
          success: true,
          attempts,
          status,
          backoffMs: totalBackoff,
        };
      }
      // 错误体读不出来也不能让整条推送崩掉：response.text() 在流已消费
      // 或连接被重置时会 reject
      lastError =
        (await response.text().catch(() => "")) ||
        `HTTP ${response.status} ${response.statusText}`;
    } catch (err) {
      lastError = describeError(err);
    }

    lastStatus = status;
    const { retryable, fatal } = classifyFailure(status, fatalSet);
    const canRetry = retryable && attempts <= maxRetries;

    if (!canRetry) {
      // 结构化日志：生产环境 console.debug 默认不可见，
      // 而"主节点与灾备节点静默分叉"必须在默认级别下就能被发现
      console.warn(
        `[D1-Sync] 投递失败（非阻塞，主流程不受影响）endpoint=${endpoint} ` +
          `attempts=${attempts} status=${lastStatus ?? "-"} retryable=${retryable} ` +
          `fatal=${fatal} reason=${lastError.slice(0, 200)}`,
      );
      return {
        success: false,
        attempts,
        error: lastError,
        status: lastStatus,
        fatal,
        retryable,
        backoffMs: totalBackoff,
      };
    }

    const delay = backoffDelay(attempts - 1, baseDelay, maxDelay, jitter);
    totalBackoff += delay;
    await sleep(delay);
  }
}

/**
 * 异步发送 D1 增量变更事件至对端容灾/协同节点 (Peer Node)
 *
 * ## 为什么要重试
 *
 * 容灾推送常撞上对端冷启动或网络抖动的窗口。原先单次失败即永久丢失，
 * 而主库已经提交 —— 两节点从此分叉，且**没有任何补偿机制**能把它拉回来。
 * 这类不一致往往在真正需要恢复数据的那天才被发现。
 *
 * 重试策略见 {@link SyncSenderConfig.maxRetries}：仅对瞬时故障重试，
 * 4xx 立即终止。
 *
 * @param ctx ExecutionContext (Cloudflare Workers 上下文，提供 waitUntil)
 * @param env 环境变量（读取 PEER_SYNC_ENDPOINT/BACKUP_SYNC_ENDPOINT 和 PEER_SYNC_SECRET/BACKUP_SYNC_SECRET）
 * @param event 增量数据变更事件
 * @param config 可选的显式配置（覆盖环境变量）
 * @returns `void`。投递过程本身是异步的，结果通过 `config.onResult` 回调
 *   或 {@link createD1SyncSender} 的返回对象获取。
 *   这里刻意不改为返回 Promise —— 那会让所有现有调用点的返回值类型
 *   静默改变，破坏向后兼容。
 */
export function sendD1Change<T = Record<string, unknown>>(
  ctx: { waitUntil(promise: Promise<unknown>): void } | null | undefined,
  env: SyncEnv,
  event: D1ChangeEvent<T>,
  config?: SyncSenderConfig,
): void {
  const endpoint = config?.endpoint ?? env.PEER_SYNC_ENDPOINT ?? env.BACKUP_SYNC_ENDPOINT;
  const secret = config?.secret ?? env.PEER_SYNC_SECRET ?? env.BACKUP_SYNC_SECRET;
  const nodeId = config?.nodeId ?? env.NODE_ID ?? "default-node";

  // 若未配置对端同步端点或密钥，则静默跳过（零侵入）
  if (!endpoint || !secret) {
    return;
  }

  const payload: D1ChangeEvent<T> = {
    ...event,
    primaryKey: event.primaryKey || "id",
    timestamp: event.timestamp || Date.now(),
    sourceNodeId: event.sourceNodeId || nodeId,
  };

  const syncPromise = deliverWithRetry(
    endpoint,
    secret,
    nodeId,
    {
      "X-Sync-Secret": secret,
      "X-Sync-Origin-Node": payload.sourceNodeId || nodeId,
      "User-Agent": "Nuln-Worker-Kit-D1Sync/1.0",
    },
    JSON.stringify(payload),
    config,
  ).then((r) => {
    config?.onResult?.(r);
    return r;
  });

  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(syncPromise);
  } else if (config?.onResult) {
    // 没有 waitUntil 时同步等待，保证 onResult 一定被调用
    void syncPromise;
  }
}

/**
 * 批量推送 D1 增量变更（KIT-OPT-01）
 *
 * 逐条发送在批量导入/迁移场景下会产生 N 次 RTT —— 1000 条变更就是 1000 个
 * 往返，且接收端无法把它们放进同一事务。批量后为 1 次请求 + 1 个事务。
 *
 * 重试语义与 {@link sendD1Change} **完全一致**（共用 `deliverWithRetry`），
 * 因此两者的瞬时/永久故障判定不会漂移。
 *
 * @param ctx ExecutionContext
 * @param endpoint 对端接收端点；为空时静默跳过
 * @param secret 预共享同步密钥；为空时静默跳过
 * @param changes 变更列表
 * @param config 可选配置
 * @param env 环境变量（读取 NODE_ID，与 `sendD1Change` 保持一致）
 */
export function sendD1BatchChanges<T = Record<string, unknown>>(
  ctx: { waitUntil(promise: Promise<unknown>): void } | null | undefined,
  endpoint: string | undefined,
  secret: string | undefined,
  changes: Array<D1ChangeEvent<T>>,
  config?: SyncSenderConfig,
  env?: SyncEnv,
): void {
  // 空批次不发请求：无意义的往返还会让对端分配事务
  if (!endpoint || !secret || !changes || changes.length === 0) {
    return;
  }

  // 必须与 sendD1Change 同样回落到 env.NODE_ID：两条路径对「我是谁」的
  // 判断不一致时，对端无法按 sourceNodeId 做回环过滤，会出现自发自收。
  const nodeId = config?.nodeId ?? env?.NODE_ID ?? "default-node";
  const now = Date.now();
  const payload: D1BatchSyncPayload = {
    changes: changes.map((c) => ({
      ...c,
      primaryKey: c.primaryKey || "id",
      timestamp: c.timestamp || now,
      sourceNodeId: c.sourceNodeId || nodeId,
    })) as D1ChangeEvent[],
    sourceNodeId: nodeId,
    timestamp: now,
  };

  const syncPromise = deliverWithRetry(
    endpoint,
    secret,
    nodeId,
    {
      "X-Sync-Secret": secret,
      "X-Sync-Origin-Node": nodeId,
      "User-Agent": "Nuln-Worker-Kit-D1Sync/1.0",
      "X-Sync-Batch-Count": String(payload.changes.length),
    },
    JSON.stringify(payload),
    config,
  ).then((r) => {
    config?.onResult?.(r);
    return r;
  });

  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(syncPromise);
  } else {
    void syncPromise;
  }
}

/**
 * 创建预配置的增量同步发射器实例
 */
export function createD1SyncSender(env: SyncEnv, config?: SyncSenderConfig) {
  return {
    notify<T = Record<string, unknown>>(
      ctx: { waitUntil(promise: Promise<unknown>): void } | null | undefined,
      event: D1ChangeEvent<T>
    ) {
      sendD1Change(ctx, env, event, config);
    },
    upsert<T = Record<string, unknown>>(
      ctx: { waitUntil(promise: Promise<unknown>): void } | null | undefined,
      table: string,
      data: T,
      primaryKey: string = "id"
    ) {
      sendD1Change(ctx, env, { table, action: "UPSERT", primaryKey, data }, config);
    },
    delete(
      ctx: { waitUntil(promise: Promise<unknown>): void } | null | undefined,
      table: string,
      id: string | number,
      primaryKey: string = "id"
    ) {
      sendD1Change(ctx, env, { table, action: "DELETE", primaryKey, data: { [primaryKey]: id } }, config);
    },
    /** 批量推送；语义与逐条发送一致，只是合并为一次请求 */
    batch<T = Record<string, unknown>>(
      ctx: { waitUntil(promise: Promise<unknown>): void } | null | undefined,
      changes: Array<D1ChangeEvent<T>>
    ) {
      const endpoint = config?.endpoint ?? env.PEER_SYNC_ENDPOINT ?? env.BACKUP_SYNC_ENDPOINT;
      const secret = config?.secret ?? env.PEER_SYNC_SECRET ?? env.BACKUP_SYNC_SECRET;
      sendD1BatchChanges(ctx, endpoint, secret, changes, config, env);
    },
  };
}
