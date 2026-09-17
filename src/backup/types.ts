/**
 * @nuln/worker-kit/backup/types
 *
 * D1 全量与增量备份、S3 远端同步与链式极简恢复数据结构定义
 */

import type { S3ClientConfig } from "../s3/types.js";

/**
 * 单表备份数据载荷
 */
export interface TableBackupData {
  /** 物理表名称 */
  name: string;
  /** 本次备份导出的记录行数 */
  rowCount: number;
  /** 字段列名列表（可选） */
  columns?: string[];
  /** 记录数组 */
  rows: Record<string, any>[];
}

/**
 * 标准通用备份数据包
 */
export interface BackupBundle {
  /** 备份格式版本 */
  version: 1;
  /** 备份模式："full" (全量) | "incremental" (增量) */
  mode?: "full" | "incremental";
  /** 所属微服务名称 (如 "mail", "tower", "oidc") */
  service: string;
  /** 增量起始水位线时间戳 (毫秒) - 仅在增量模式下有效 */
  sinceTimestamp?: number;
  /** 增量结束水位线时间戳 (毫秒) - 仅在增量模式下有效 */
  untilTimestamp?: number;
  /** 备份终点/生成时间戳 (毫秒) */
  timestamp: number;
  /** ISO 格式时间字符串 */
  createdAt: string;
  /** 本次变更的总行数 */
  totalChangedRows?: number;
  /** SHA-256 数据校验和 (格式: "sha256:<hex>") */
  checksum: string;
  /** 各表数据映射字典 */
  tables: Record<string, TableBackupData>;
  /** 随附的系统静态配置快照 (如 settings, site_config) */
  staticConfig?: Record<string, any>;
  /** 附加自定义元数据 */
  metadata?: Record<string, any>;
}

/**
 * 增量备份包（特化类型别名）
 */
export type IncrementalBackupBundle = BackupBundle & {
  mode: "incremental";
  sinceTimestamp: number;
  totalChangedRows: number;
};

/**
 * D1 全量导出配置选项
 */
export interface D1ExportOptions {
  /** 微服务名称标识，默认 "service" */
  serviceName?: string;
  /** 包含的表白名单（未提供则导出除 SQLite 内部表外的全部表） */
  includeTables?: string[];
  /** 排除的表黑名单（如敏感临时表） */
  excludeTables?: string[];
  /** 游标分批读取批次大小 (默认 1000) */
  batchSize?: number;
  /** 自定义元数据 */
  metadata?: Record<string, any>;
}

/**
 * D1 增量导出配置选项
 */
export interface D1IncrementalExportOptions extends D1ExportOptions {
  /** 增量起始水位线时间戳（毫秒或 ISO 字符串，0 表示导出当前全部数据作为基线） */
  sinceTimestamp: number;
  /** 增量终点时间戳（默认为当前 Date.now()） */
  untilTimestamp?: number;
  /** 静态小配置表名单（每次全量附带，如 ['settings', 'site_config']） */
  staticTables?: string[];
}

/**
 * D1 恢复配置选项
 */
export interface D1RestoreOptions {
  /** 是否校验 SHA-256 校验和（默认 true） */
  verifyChecksum?: boolean;
  /** 恢复前是否先清空已有数据表（默认 false） */
  truncateBeforeInsert?: boolean;
  /** 遇到主键冲突时的策略：'replace' (覆盖，默认) | 'ignore' (忽略) | 'error' (报错) */
  conflictStrategy?: "replace" | "ignore" | "error";
  /** 仅恢复指定的表白名单 */
  includeTables?: string[];
  /** 分批写入大小 (默认 50) */
  batchSize?: number;
}

/**
 * 单包恢复执行结果摘要
 */
export interface RestoreSummary {
  /** 是否恢复成功 */
  success: boolean;
  /** 成功恢复的数据表列表 */
  restoredTables: string[];
  /** 累计写入/更新的记录总行数 */
  totalRowsInserted: number;
  /** 执行耗时 (毫秒) */
  durationMs: number;
  /** 错误信息 */
  error?: string;
}

/**
 * 定时 S3 全量备份选项
 */
export interface ScheduledS3BackupOptions {
  /** Cloudflare D1 数据库实例绑定 */
  db: any;
  /** 微服务名称 */
  serviceName: string;
  /** S3 存储桶与认证配置 */
  s3: S3ClientConfig;
  /** S3 保存前缀，默认为 "backups/" */
  keyPrefix?: string;
  /** 备份文件保留天数（超过该天数的备份文件自动从 S3 删除，默认 30 天，0 表示不删除） */
  retentionDays?: number;
  /** 最大保留备份数量上限（超过上限的最早备份将被自动删除，0 表示不限制） */
  maxBackups?: number;
  /** 表导出配置 */
  exportOptions?: Omit<D1ExportOptions, "serviceName">;
}

/**
 * 定时 S3 全量备份结果
 */
export interface ScheduledS3BackupResult {
  success: boolean;
  uploadedKey: string;
  bundleSize: number;
  checksum: string;
  deletedKeys: string[];
  durationMs: number;
}

/**
 * 定时 S3 增量备份选项
 */
export interface ScheduledIncrementalBackupOptions {
  /** Cloudflare D1 数据库实例绑定 */
  db: any;
  /** 微服务名称 (如 "mail", "oidc", "tower") */
  serviceName: string;
  /** S3 存储桶与认证配置 */
  s3: S3ClientConfig;
  /** S3 保存前缀，默认为 "backups/" */
  keyPrefix?: string;
  /** 备份间隔（小时，如 1, 6, 12, 24）。若距离上次备份时间未达到间隔，则自动跳过 */
  intervalHours?: number;
  /** 强制指定增量起始水位线时间戳（若不传则自动从 S3 latest_watermark.json 读取） */
  sinceTimestamp?: number;
  /** 静态小配置表名单（每次全量附带，如 ['settings', 'site_config']） */
  staticTables?: string[];
  /** 包含的表白名单 */
  includeTables?: string[];
  /** 排除的表黑名单（如临时表） */
  excludeTables?: string[];
  /** 当无任何数据变动时，是否跳过 S3 增量包上传（默认 true，极大节约 S3 写入与存储） */
  skipZeroChanges?: boolean;
  /** 增量备份文件保留天数（默认 30 天，0 表示不清理） */
  retentionDays?: number;
  /** 最大保留增量文件数（默认 200，0 表示不限制） */
  maxBackups?: number;
}

/**
 * 定时 S3 增量备份执行结果
 */
export interface ScheduledIncrementalBackupResult {
  success: boolean;
  /** 是否跳过了上传（在 0 数据变动或未到时间间隔且 skipZeroChanges=true 时为 true） */
  skipped: boolean;
  /** 跳过原因 */
  skipReason?: "zero_changes" | "interval_not_reached";
  /** 上传至 S3 的增量包 Key（跳过时为 undefined） */
  uploadedKey?: string;
  /** 增量包大小（字节） */
  bundleSize: number;
  /** 本次增量变更的总行数 */
  totalChangedRows: number;
  /** 当前增量包的起始水位线 */
  sinceTimestamp: number;
  /** 当前增量包的结束水位线 */
  untilTimestamp: number;
  /** SHA-256 校验和 */
  checksum?: string;
  /** 自动清理删除的过期 S3 Key 列表 */
  deletedKeys: string[];
  /** 耗时 (毫秒) */
  durationMs: number;
}

/**
 * S3 上的最新水位线元数据
 */
export interface WatermarkState {
  service: string;
  lastWatermark: number;
  lastBackupKey: string;
  lastBackupTime: string;
  totalChangedRows: number;
  checksum: string;
}

/**
 * S3 备份文件条目元信息
 */
export interface S3BackupFileSummary {
  key: string;
  size: number;
  lastModified?: string;
  service: string;
  type: "baseline" | "incremental";
  sinceTimestamp?: number;
  untilTimestamp: number;
  isIncremental: boolean;
}

/**
 * 备份系统运行状态摘要（用于前端管理后台展示）
 */
export interface BackupStatusResult {
  /** 是否已存在首次全量基线备份 */
  hasBaseline: boolean;
  /** 首次全量基线文件 S3 Key */
  baselineKey?: string;
  /** 首次全量基线生成时间 */
  baselineTime?: string;
  /** 最新增量备份时间戳 (毫秒) */
  latestWatermark?: number;
  /** 最新增量备份 ISO 时间 */
  latestBackupTime?: string;
  /** 配置的备份间隔（小时） */
  intervalHours: number;
  /** 是否已启用自动备份（配置了 S3 存储桶与密钥） */
  autoBackupEnabled: boolean;
  /** S3 现存备份包总数 */
  totalBackupsCount: number;
}

/**
 * S3 增量恢复模式
 */
export type IncrementalRestoreMode = "latest" | "timeframe" | "selected";

/**
 * S3 增量链极简恢复选项
 */
export interface IncrementalRestoreOptions {
  /** Cloudflare D1 数据库实例绑定 */
  db: any;
  /** 微服务名称 */
  serviceName: string;
  /** S3 存储桶与认证配置 */
  s3: S3ClientConfig;
  /** S3 保存前缀，默认为 "backups/" */
  keyPrefix?: string;
  /** 恢复模式："latest" (最新全量) | "timeframe" (按时间段) | "selected" (按勾选包) */
  mode?: IncrementalRestoreMode;
  /** 指定的具体增量包 S3 Keys 列表 (在 mode="selected" 时使用) */
  bundleKeys?: string[];
  /** 恢复回溯的终点时间戳（默认 Date.now()） */
  untilTimestamp?: number;
  /** 恢复回溯的起点时间戳（可选，默认 0） */
  sinceTimestamp?: number;
  /** 仅恢复指定的表白名单（可选） */
  includeTables?: string[];
  /** 冲突策略：'replace' (覆盖，默认) | 'ignore' | 'error' */
  conflictStrategy?: "replace" | "ignore" | "error";
  /** 是否仅做 Dry-Run 预检不实际写入 D1（默认 false） */
  dryRun?: boolean;
}

/**
 * S3 增量链极简恢复执行结果
 */
export interface IncrementalRestoreResult {
  /** 是否全部成功 */
  success: boolean;
  /** 恢复模式：Dry-Run 还是真实写入 */
  dryRun: boolean;
  /** 参与重放的增量包数量 */
  appliedBundlesCount: number;
  /** 参与重放的增量包 S3 Keys */
  appliedBundleKeys: string[];
  /** 成功恢复或影响的数据表列表 */
  restoredTables: string[];
  /** 累计恢复/更新的总行数 */
  totalRowsAffected: number;
  /** 执行总耗时 (毫秒) */
  durationMs: number;
  /** 各增量包明细报告 */
  bundleReports: Array<{
    key: string;
    sinceTimestamp?: number;
    untilTimestamp: number;
    rowCount: number;
    durationMs: number;
  }>;
  /** 错误信息 */
  error?: string;
}
