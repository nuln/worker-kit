/**
 * @nuln/worker-kit/notify/drivers/telegram
 */

import type { NotificationPayload, TelegramConfig, SendResult } from "../types.js";
import { formatToTelegramHtml } from "../formatters.js";
import { PLATFORM_LIMITS, truncateForPlatform } from "../security.js";

export async function sendTelegram(
  config: TelegramConfig,
  payload: NotificationPayload
): Promise<SendResult> {
  const { botToken, chatId, disableWebPagePreview } = config;

  if (!botToken || !chatId) {
    return { ok: false, channel: "telegram", error: "botToken and chatId are required" };
  }

  // 仅接受**显式**开关 MOCK_EXTERNAL_API 作为测试替身。
  // 曾有的 `X.includes("mock")` 属于子串猜测：生产环境把 mock 写进 URL 路径
  // （如 https://api.example.com/mock/v1/send）会命中该分支，只打日志后返回
  // `{ ok: true }`，告警静默丢失且调用方收到"成功"。
  if (
    (typeof process !== "undefined" && process.env?.MOCK_EXTERNAL_API === "true")
  ) {
    return { ok: true, channel: "telegram", messageId: `tg_mock_${Date.now()}` };
  }

  // Telegram 对 `text` 的硬上限是 4096 UTF-8 字符。超限时返回
  // 400 Bad Request: message is too long，整条告警**静默丢失** ——
  // 而丢的往往正是最该看到的那条（几十行异常堆栈）。
  const text = truncateForPlatform(
    formatToTelegramHtml(payload),
    PLATFORM_LIMITS.telegram.maxLength,
    "\n\n[Content truncated due to platform size limit]",
    PLATFORM_LIMITS.telegram.unit,
  );
  const url = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`;

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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: disableWebPagePreview ?? false,
    }),
    signal: outboundSignal,
    redirect: "manual",
  });
  } catch (err) {
    return {
      ok: false,
      channel: "telegram",
      error: `网络请求失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    return {
      ok: false,
      channel: "telegram",
      error: `Telegram API error (${res.status}): ${errorText}`,
    };
  }

  // 响应体解析失败或缺少 result 字段时判为**失败**。
  // 历史实现用 `.catch(() => ({}))` 把解析失败吞成空对象，随后
  // `data?.result?.message_id` 取不到值也只是 messageId 为 undefined，
  // 仍返回 ok: true —— 于是「返回了 HTML 错误页」也被当成投递成功。
  const data: any = await res.json().catch(() => null);
  if (!data || typeof data !== "object") {
    return { ok: false, channel: "telegram", error: "Telegram 返回了非 JSON 响应体" };
  }
  if (data.ok === false) {
    return { ok: false, channel: "telegram", error: `Telegram API 报错: ${data.description ?? "unknown"}` };
  }
  // 缺少 `result` 一律判失败。
  //
  // 上面那段注释曾声称"缺少 result 字段时判为失败"，但代码只判了
  // `data.ok === false`：一个 HTTP 200、响应体为 `{}` 的响应
  // （代理截断、WAF 改写、未来的 API 变更）会带着 `messageId: undefined`
  // 返回 `ok: true` —— 告警被判为投递成功，而消息从未送达。
  //
  // sendMessage 的成功响应必然带 `result`，因此这个判定不会误伤。
  if (!data.result || typeof data.result !== "object") {
    return {
      ok: false,
      channel: "telegram",
      error: `Telegram 响应缺少 result 字段（description=${data.description ?? "无"}）`,
    };
  }
  const messageId = data.result.message_id !== undefined ? String(data.result.message_id) : undefined;
  return { ok: true, channel: "telegram", messageId };
}
