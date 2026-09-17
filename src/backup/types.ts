/**
 * @nuln/worker-kit/backup/types
 *
 * D1 备份与恢复数据结构与配置定义
 */

import type { S3ClientConfig } from "../s3/types.js";

export interface TableBackupData {
  name: string;
  rowCount: number;
  columns?: string[];
  rows: Record<string, any>[];
}

export interface BackupBundle {
  /** 备份格式版本 */
  version: 1;
  /** 所属微服务名称 (如 "mail", "tower", "oidc") */
  service: string;
  /** 备份生成时间戳 (毫秒) */
  timestamp: number;
  /** ISO 格式时间字符串 */
  createdAt: string;
  /** SHA-256 数据校验和 */
  checksum: string;
  /** 各表数据映射 */
  tables: Record<string, TableBackupData>;
  /** 附加自定义元数据 */
  metadata?: Record<string, any>;
}

export interface D1ExportOptions {
  /** 微服务名称标识，默认 "service" */
  serviceName?: string;
  /** 包含的表白名单（未提供则导出除 SQLite 内部表外的全部表） */
  includeTables?: string[];
  /** 排除的表黑名单（如敏感临时表） */
  excludeTables?: string[];
  /** 自定义元数据 */
  metadata?: Record<string, any>;
}

export interface D1RestoreOptions {
  /** 是否校验 SHA-256 校验和（默认 true） */
  verifyChecksum?: boolean;
  /** 恢复前是否先清空已有数据表（默认 false） */
  truncateBeforeInsert?: boolean;
  /** 遇到主键冲突时的策略：'replace' (覆盖) | 'ignore' (忽略) | 'error' (报错) */
  conflictStrategy?: "replace" | "ignore" | "error";
  /** 仅恢复指定的表白名单 */
  includeTables?: string[];
}

export interface RestoreSummary {
  success: boolean;
  restoredTables: string[];
  totalRowsInserted: number;
  durationMs: number;
  error?: string;
}

export interface ScheduledS3BackupOptions {
  /** Cloudflare D1 数据库实例绑定 */
  db: any;
  /** 微服务名称 */
  serviceName: string;
  /** S3 存储桶与认证配置 */
  s3: S3ClientConfig;
  /** S3 保存前缀，默认为 "backups/{serviceName}/" */
  keyPrefix?: string;
  /** 备份文件保留天数（超过该天数的备份文件自动从 S3 删除，默认 30 天，0 表示不删除） */
  retentionDays?: number;
  /** 最大保留备份数量上限（超过上限的最早备份将被自动删除，0 表示不限制） */
  maxBackups?: number;
  /** 表导出配置 */
  exportOptions?: Omit<D1ExportOptions, "serviceName">;
}

export interface ScheduledS3BackupResult {
  success: boolean;
  uploadedKey: string;
  bundleSize: number;
  checksum: string;
  deletedKeys: string[];
  durationMs: number;
}
