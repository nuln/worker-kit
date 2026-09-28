/**
 * @nuln/worker-kit/notify/engine
 *
 * 统一多通道通知分发调度引擎与测试探测工具
 */

import type {
  NotificationChannelType,
  NotificationPayload,
  DispatchNotificationOptions,
  SendResult,
  TestNotificationResult,
} from "./types.js";
import { sendTelegram } from "./drivers/telegram.js";
import { sendBark } from "./drivers/bark.js";
import { sendFeishu } from "./drivers/feishu.js";
import { sendWeCom } from "./drivers/wecom.js";
import { sendWebhook } from "./drivers/webhook.js";
import { sendEmail } from "./drivers/email.js";

/**
 * 将通知定向派发至指定通道（底层驱动直连）
 */
export async function sendChannelNotification(
  channel: NotificationChannelType,
  config: Record<string, any>,
  payload: NotificationPayload,
  env: any = {}
): Promise<SendResult> {
  try {
    switch (channel) {
      case "telegram":
        return await sendTelegram(config as any, payload);
      case "bark":
        return await sendBark(config as any, payload);
      case "feishu":
        return await sendFeishu(config as any, payload);
      case "wecom":
        return await sendWeCom(config as any, payload);
      case "webhook":
        return await sendWebhook(config as any, payload);
      case "email":
        return await sendEmail(config as any, payload, env);
      default:
        return {
          ok: false,
          channel,
          error: `Unsupported notification channel: ${channel}`,
        };
    }
  } catch (err: any) {
    return {
      ok: false,
      channel,
      error: `Driver exception on ${channel}: ${err?.message || String(err)}`,
    };
  }
}

/**
 * 统一通知派发入口
 * 支持 ExecutionContext (ctx.waitUntil) 异步非阻塞执行与独立 Fail-Safe 异常捕获
 */
export async function dispatchNotification<
  TChannel extends NotificationChannelType = NotificationChannelType
>(options: DispatchNotificationOptions<TChannel>): Promise<SendResult> {
  const { channel, config, payload, env, ctx } = options;

  const runTask = async (): Promise<SendResult> => {
    try {
      const res = await sendChannelNotification(channel, config, payload, env);
      if (!res.ok) {
        console.warn(`[notify-warn] ${channel} failed:`, res.error);
      }
      return res;
    } catch (err: any) {
      console.error(`[notify-fail-safe] ${channel} error:`, err);
      return {
        ok: false,
        channel,
        error: err?.message || String(err),
      };
    }
  };

  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(runTask());
    return { ok: true, channel };
  }

  return await runTask();
}

/**
 * 批量广播通知给用户配置的多个通道（支持事件类型过滤）
 */
export async function broadcastNotification(
  channels: Array<{
    channel: NotificationChannelType;
    config: Record<string, any>;
    enabled?: boolean;
    events?: Record<string, boolean | undefined>;
  }>,
  payload: NotificationPayload,
  options: {
    event?: string;
    env?: any;
    ctx?: { waitUntil?: (p: Promise<any>) => void };
  } = {}
): Promise<SendResult[]> {
  const { env, ctx } = options;
  // 事件名回落到 payload.event。
  //
  // `NotificationPayload.event` 与 `options.event` 两处都存在，若只认 options：
  // 调用方很自然地写 `payload: { event: "backup" }` 而忘了传 options.event，
  // 事件过滤就**静默失效** —— 用户在后台关掉的告警通道照旧推送，
  // 且没有任何报错。这属 fail-open，必须兜住。
  const event = options.event ?? payload.event;

  const targetChannels = channels.filter((ch) => {
    if (ch.enabled === false) return false;
    if (event && ch.events && ch.events[event] === false) return false;
    return true;
  });

  if (targetChannels.length === 0) {
    return [];
  }

  const broadcastTask = async (): Promise<SendResult[]> => {
    const results = await Promise.allSettled(
      targetChannels.map((ch) =>
        sendChannelNotification(ch.channel, ch.config, payload, env)
      )
    );

    return results.map((r, i) => {
      if (r.status === "fulfilled") {
        return r.value;
      }
      return {
        ok: false,
        channel: targetChannels[i].channel,
        error: r.reason?.message || String(r.reason),
      };
    });
  };

  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(broadcastTask());
    return targetChannels.map((ch) => ({ ok: true, channel: ch.channel }));
  }

  return await broadcastTask();
}

/**
 * 向指定通道配置发送测试探测消息
 */
export async function testChannelNotification(
  channel: NotificationChannelType,
  config: Record<string, any>,
  env: any = {},
  lang = "zh-CN"
): Promise<TestNotificationResult> {
  const isEn = lang.toLowerCase().startsWith("en");

  const testPayload: NotificationPayload = {
    title: isEn ? "🧪 Test Security Notification" : "🧪 测试安全通知",
    message: isEn
      ? `This is a test message from Nuln Security Guard. Your ${channel} channel is successfully connected!`
      : `这是一条来自 Nuln 安全守护的测试消息。您的 ${channel} 通知渠道已成功配置并联通！`,
    level: "info",
    event: "test",
    details: {
      [isEn ? "Channel" : "渠道"]: channel,
      [isEn ? "Status" : "状态"]: isEn ? "Connected" : "连接正常",
      [isEn ? "Test Time" : "测试时间"]: new Date().toISOString(),
    },
    timestamp: Date.now(),
  };

  return await sendChannelNotification(channel, config, testPayload, env);
}
