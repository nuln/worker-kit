/**
 * @nuln/worker-kit/notify
 *
 * 核心通知类型与接口契约
 */

export type NotificationChannelType =
  | "telegram"
  | "bark"
  | "feishu"
  | "wecom"
  | "webhook"
  | "email";

export type NotificationLevel = "info" | "warning" | "alert";

export interface NotificationPayload {
  /** 通知标题 */
  title: string;
  /** 通知主体描述文本 */
  message: string;
  /** 告警严重级别（默认 info） */
  level?: NotificationLevel;
  /** 触发事件类型标识，如 "login", "bind", "backup", "system_alert" */
  event?: string;
  /** 扩展键值对元数据 */
  details?: Record<string, string | number | boolean | null | undefined>;
  /** 关联操作或跳转链接 */
  link?: string;
  /** 时间戳（毫秒，默认当前时间） */
  timestamp?: number;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  disableWebPagePreview?: boolean;
}

export interface BarkConfig {
  deviceKey: string;
  server?: string;
  group?: string;
  sound?: string;
  icon?: string;
  badge?: number;
}

export interface FeishuConfig {
  webhookUrl: string;
  secret?: string;
}

export interface WeComConfig {
  webhookUrl: string;
}

export interface WebhookConfig {
  url: string;
  secret?: string;
  headers?: Record<string, string>;
}

export interface EmailChannelConfig {
  to: string;
  subject?: string;
  from?: string;
}

export interface ChannelConfigMap {
  telegram: TelegramConfig;
  bark: BarkConfig;
  feishu: FeishuConfig;
  wecom: WeComConfig;
  webhook: WebhookConfig;
  email: EmailChannelConfig;
}

export interface NotificationRecord<TChannel extends NotificationChannelType = NotificationChannelType> {
  id: string;
  userId?: string;
  channel: TChannel;
  enabled: boolean;
  config: ChannelConfigMap[TChannel] | Record<string, any>;
  events: Record<string, boolean>;
  created_at: number;
  updated_at: number;
}

export interface DispatchNotificationOptions<TChannel extends NotificationChannelType = NotificationChannelType> {
  channel: TChannel;
  config: ChannelConfigMap[TChannel] | Record<string, any>;
  payload: NotificationPayload;
  env?: any;
  ctx?: { waitUntil?: (p: Promise<any>) => void };
  lang?: string;
}

export interface SendResult {
  ok: boolean;
  channel: NotificationChannelType;
  messageId?: string;
  error?: string;
}

export interface TestNotificationResult {
  ok: boolean;
  channel: NotificationChannelType;
  messageId?: string;
  error?: string;
}
