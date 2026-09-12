/**
 * @nuln/worker-kit/sync
 * 通用 D1 增量数据同步类型定义
 */

export type SyncAction = "UPSERT" | "DELETE";

/**
 * 增量数据变更事件结构体（支持对等双向同步）
 */
export interface D1ChangeEvent<T = Record<string, unknown>> {
  /** 目标数据库表名 */
  table: string;
  /** 同步操作类型：UPSERT (新增/更新) 或 DELETE (删除) */
  action: SyncAction;
  /** 主键字段名，默认为 "id" */
  primaryKey?: string;
  /** 业务数据载荷（UPSERT 时为整行字段对象，DELETE 时仅需包含主键） */
  data: T;
  /** 变更发生时间戳 (毫秒) */
  timestamp?: number;
  /** 发送源节点唯一标识 (如 "cf-edge-01", "nas-node-02")，防止回环风暴 */
  sourceNodeId?: string;
  /** 预共享同步密钥（若在 Header 中传递可省略） */
  syncSecret?: string;
}

/**
 * 增量同步发射器配置
 */
export interface SyncSenderConfig {
  /** 对端节点的接收端点 URL (如 https://node-b.com/oidc/api/internal/sync/d1) */
  endpoint?: string;
  /** 预共享同步通信密钥 */
  secret?: string;
  /** 本地节点唯一标识 */
  nodeId?: string;
  /** 请求超时时间 (毫秒，默认 5000) */
  timeoutMs?: number;
  /** 自定义 fetch 实现（方便测试或 mocking） */
  customFetch?: typeof fetch;
}

/**
 * 增量同步接收端响应结构
 */
export interface SyncResponse {
  ok: boolean;
  synced: boolean;
  table?: string;
  action?: SyncAction;
  timestamp: number;
  sourceNodeId?: string;
  error?: string;
}

/**
 * 环境变量接口规范（支持双向对等配置与向后兼容）
 */
export interface SyncEnv {
  NODE_ID?: string;
  PEER_SYNC_ENDPOINT?: string;
  PEER_SYNC_SECRET?: string;
  BACKUP_SYNC_ENDPOINT?: string;
  BACKUP_SYNC_SECRET?: string;
  DB?: unknown;
  database?: unknown;
  [key: string]: any;
}
