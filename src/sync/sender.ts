/**
 * @nuln/worker-kit/sync
 * 增量数据同步发射器 (Sync Sender)
 * 运行于主服务 (Cloudflare)，在写入主库后以非阻塞方式异步推送增量数据至备用节点 (NAS open-compute)
 */

import type { D1ChangeEvent, SyncEnv, SyncSenderConfig } from "./types.js";

/**
 * 异步发送 D1 增量变更事件至对端容灾/协同节点 (Peer Node)
 *
 * @param ctx ExecutionContext (Cloudflare Workers 上下文，提供 waitUntil)
 * @param env 环境变量（读取 PEER_SYNC_ENDPOINT/BACKUP_SYNC_ENDPOINT 和 PEER_SYNC_SECRET/BACKUP_SYNC_SECRET）
 * @param event 增量数据变更事件
 * @param config 可选的显式配置（覆盖环境变量）
 */
export function sendD1Change<T = Record<string, unknown>>(
  ctx: { waitUntil(promise: Promise<unknown>): void } | null | undefined,
  env: SyncEnv,
  event: D1ChangeEvent<T>,
  config?: SyncSenderConfig
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

  const fetchImpl = config?.customFetch ?? fetch;
  const timeoutMs = config?.timeoutMs ?? 5000;

  const syncPromise = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sync-Secret": secret,
          "X-Sync-Origin-Node": payload.sourceNodeId || nodeId,
          "User-Agent": "Nuln-Worker-Kit-D1Sync/1.0",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        console.warn(
          `[D1-Sync] 对端增量同步响应非 200: ${response.status} ${response.statusText}`,
          errorText
        );
      }
    } catch (err: unknown) {
      // 容灾推送必须静默容错，禁止抛出异常破坏主业务流程
      console.warn("[D1-Sync] 对端增量同步推送异常 (非阻塞):", err);
    }
  })();

  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(syncPromise);
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
  };
}
