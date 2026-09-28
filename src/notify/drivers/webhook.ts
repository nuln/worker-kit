/**
 * @nuln/worker-kit/notify/drivers/webhook
 */

import type { NotificationPayload, WebhookConfig, SendResult } from "../types.js";
import { assertSafePublicUrl } from "../security.js";

async function genHmacSha256(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sendWebhook(
  config: WebhookConfig,
  payload: NotificationPayload
): Promise<SendResult> {
  const { url, secret, headers: customHeaders } = config;

  if (!url) {
    return { ok: false, channel: "webhook", error: "url is required" };
  }

  try {
    assertSafePublicUrl(url);
  } catch (err: any) {
    return { ok: false, channel: "webhook", error: `Invalid Webhook URL: ${err.message}` };
  }

  if (
    (typeof process !== "undefined" && process.env?.MOCK_EXTERNAL_API === "true")
  ) {
    return { ok: true, channel: "webhook", messageId: `webhook_mock_${Date.now()}` };
  }

  const rawBody = JSON.stringify({
    event: payload.event || "notification",
    title: payload.title,
    message: payload.message,
    level: payload.level || "info",
    details: payload.details || {},
    link: payload.link || undefined,
    timestamp: payload.timestamp || Date.now(),
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Nuln-Worker-Kit-Notify/1.0",
    ...customHeaders,
  };

  if (secret && secret.trim()) {
    const signature = await genHmacSha256(secret, rawBody);
    headers["X-Hub-Signature-256"] = `sha256=${signature}`;
    headers["X-Signature-SHA256"] = signature;
  }

  // 出站请求加固：5s 超时 + 禁止自动跟随重定向。
  // 默认的 `redirect: "follow"` 会让公网 URL 返回 302 跳到内网地址，
  // 使 assertSafePublicUrl 的 SSRF 首跳校验形同虚设（该检查只作用于首跳 URL）。
  const outboundSignal = AbortSignal.timeout(5000);
  // 出站请求必须整体包在 try/catch 内：DNS 失败 / 连接被拒 / 超时会让 fetch
  // 的 Promise reject，若不捕获，异常会冒泡到调用方。
  //
  // 消费侧通常写成 `notify.sendX(...).then(res => { err = res.ok ? null : res.error })`：
  // reject 时 then 回调根本不执行，err 保持初始值（成功语义），外层再 `.catch(()=>{})`
  // 吞掉 —— 最终**网络故障被上报为「告警投递成功」**。这是最坏的一类 fail-open：
  // 告警系统自己静默失效且无任何信号。
  let res: Response;
  try {
    res = await fetch(url, {
    method: "POST",
    headers,
    body: rawBody,
    signal: outboundSignal,
    redirect: "manual",
  });
  } catch (err) {
    return {
      ok: false,
      channel: "webhook",
      error: `网络请求失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return {
      ok: false,
      channel: "webhook",
      error: `Webhook returned status ${res.status}: ${errText}`,
    };
  }

  return { ok: true, channel: "webhook", messageId: `webhook_${Date.now()}` };
}
