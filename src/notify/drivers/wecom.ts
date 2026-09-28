/**
 * @nuln/worker-kit/notify/drivers/wecom
 */

import type { NotificationPayload, WeComConfig, SendResult } from "../types.js";
import { PLATFORM_LIMITS, assertSafePublicUrl, truncateForPlatform } from "../security.js";
import { formatToWeComMarkdown } from "../formatters.js";

export async function sendWeCom(
  config: WeComConfig,
  payload: NotificationPayload
): Promise<SendResult> {
  const { webhookUrl } = config;

  if (!webhookUrl) {
    return { ok: false, channel: "wecom", error: "webhookUrl is required" };
  }

  try {
    assertSafePublicUrl(webhookUrl);
  } catch (err: any) {
    return { ok: false, channel: "wecom", error: `Invalid WeCom webhook URL: ${err.message}` };
  }

  if (
    (typeof process !== "undefined" && process.env?.MOCK_EXTERNAL_API === "true")
  ) {
    return { ok: true, channel: "wecom", messageId: `wecom_mock_${Date.now()}` };
  }

  // 企业微信 markdown.content 上限 4096 **字节**（不是字符）——
  // 中文一个字 3 字节，2000 字的中文告警就会超限。
  // 截断必须按字节计且不能劈开 UTF-8 序列，否则平台直接拒收。
  const content = truncateForPlatform(
    formatToWeComMarkdown(payload),
    PLATFORM_LIMITS.wecom.maxLength,
    "\n\n[Content truncated due to platform size limit]",
    PLATFORM_LIMITS.wecom.unit,
  );

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
    res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msgtype: "markdown",
      markdown: {
        content,
      },
    }),
    signal: outboundSignal,
    redirect: "manual",
  });
  } catch (err) {
    return {
      ok: false,
      channel: "wecom",
      error: `网络请求失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return {
      ok: false,
      channel: "wecom",
      error: `WeCom API HTTP error (${res.status}): ${errText}`,
    };
  }

  // 解析失败判为失败（此前 `.catch(() => ({}))` 会让「返回 HTML 错误页」被
  // 当作投递成功，告警静默丢失）
  const data: any = await res.json().catch(() => null);
  if (!data || typeof data !== "object") {
    return { ok: false, channel: "wecom", error: "WeCom 返回了非 JSON 响应体" };
  }
  // 业务字段**缺失**同样判失败（与 bark/telegram 保持同一口径）。
  //
  // 原判定 `data?.errcode !== 0 && data?.errcode !== undefined` 会在
  // HTTP 200 + `{}` 时落到成功分支，把异常响应当成投递成功。
  // 企业微信成功响应必然带 errcode:0，故要求字段存在是安全的。
  if (data?.errcode === undefined || data.errcode !== 0) {
    return {
      ok: false,
      channel: "wecom",
      error: `WeCom API error (${data.errcode}): ${data.errmsg}`,
    };
  }

  return { ok: true, channel: "wecom", messageId: `wecom_${Date.now()}` };
}
