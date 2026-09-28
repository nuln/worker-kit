/**
 * @nuln/worker-kit/sync
 * 通用 D1 增量数据同步类型定义
 */

export type SyncAction = "UPSERT" | "DELETE";

/**
 * 同步推送的投递结果。
 *
 * ## 为什么需要它
 *
 * 原先 `sendD1Change` 返回 `void`，失败只落一条 `console.debug`。
 * 这带来两个问题：
 *
 * 1. **无法判断重试是否值得**。502（对端冷启动）与 401（密钥错配）都走
 *    同一条 catch，前者该重试、后者重试一万次也一样。
 * 2. **失败不可观测**。`console.debug` 在生产默认关闭，于是
 *    "主节点与灾备节点静默分叉"这件事在监控上完全不可见。
 *
 * 调用方可以据此决定：把变更写入本地补偿队列，还是仅告警。
 */
export interface SyncDeliveryResult {
  /** 最终是否投递成功 */
  success: boolean;
  /** 实际尝试次数（含首次）。未配置对端时为 0 */
  attempts: number;
  /** 失败原因（人类可读，不含密钥） */
  error?: string;
  /** 最后一次尝试收到的 HTTP 状态码（网络异常时无此字段） */
  status?: number;
  /** 是否因「不可重试」而提前终止（4xx 鉴权/格式类错误） */
  fatal?: boolean;
  /**
   * 是否被判定为「值得重试」的瞬时故障。
   *
   * 502/503/504 与网络异常为 true；4xx 为 false。
   */
  retryable?: boolean;
  /** 跳过的毫秒数总和（便于观测退避成本） */
  backoffMs?: number;
}

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
  /**
   * 瞬时故障的**最大重试次数**（不含首次尝试，默认 2）。
   *
   * 为什么需要重试：容灾推送常发生在对端**冷启动**或网络抖动的窗口，
   * 此时单次失败即永久丢失该条变更，而主库已提交 —— 两节点从此分叉，
   * 且没有任何补偿机制能把它拉回来。
   *
   * 设 0 可完全关闭重试（回到旧行为）。
   */
  maxRetries?: number;
  /** 首次退避间隔 (毫秒，默认 100)。后续按指数递增 */
  retryBaseDelayMs?: number;
  /** 退避上限 (毫秒，默认 2000)，防止指数增长到不可接受的等待 */
  retryMaxDelayMs?: number;
  /**
   * 退避抖动系数 (0~1，默认 0.2)。
   *
   * 多个节点同时失败时，无抖动的固定退避会让它们在同一毫秒一起重试，
   * 正好在对端尚未恢复的瞬间再次压垮它。抖动把重试摊开到一个时间窗内。
   */
  retryJitter?: number;
  /**
   * 强制视为「不可重试」的状态码集合（默认 400/401/403/404/422）。
   *
   * 这类错误重试无意义：密钥错配、载荷非法、路径不存在，重试一万次
   * 结果一样，只会白白占用对端资源并推迟告警可见时间。
   */
  fatalStatusCodes?: number[];
  /**
   * 投递结果回调。
   *
   * 存在的理由：推送是异步的（`waitUntil`），函数本身返回 `void`。
   * 没有这个回调，调用方无法得知该条变更是否真的送达 —— 而
   * "不知道"正是这类静默分叉最难排查的地方。
   */
  onResult?: (result: SyncDeliveryResult) => void;
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
 * 批量增量同步载荷。
 *
 * 逐条发送在批量导入/迁移场景下会产生 N 次 RTT —— 1000 条变更就是 1000 个
 * 往返。批量后为 1 次，且接收端可用 `db.batch()` 放进同一个事务，
 * 消除"前 500 条成功、第 501 条失败"的中间态。
 */
export interface D1BatchSyncPayload {
  /** 变更列表，按应用顺序执行 */
  changes: D1ChangeEvent[];
  /** 发送源节点标识 */
  sourceNodeId?: string;
  /** 批次产生时间戳 (毫秒) */
  timestamp?: number;
}

/**
 * 单条变更在批量应用中的结果。
 *
 * 批量**不保证原子**：D1 的 `db.batch()` 本身是原子的，但当部分语句因
 * LWW 守卫被跳过、或单条语句失败需要降级时，整体结果需要逐条可见，
 * 否则调用方无法知道哪几条没落库。
 */
export interface D1BatchApplyResult {
  /** 是否全部成功应用 */
  ok: boolean;
  /** 实际写入的语句数 */
  applied: number;
  /** 因 LWW 守卫被跳过的变更数（数据比事件旧，属正确行为） */
  skipped: number;
  /** 失败明细（表名 + 原因），不含业务数据 */
  failures: Array<{ table: string; action: SyncAction; error: string }>;
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
