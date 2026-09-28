/**
 * @nuln/worker-kit/notify/drivers/bark
 */

import type { NotificationPayload, BarkConfig, SendResult } from "../types.js";
import { PLATFORM_LIMITS, assertSafePublicUrl, truncateForPlatform } from "../security.js";

export async function sendBark(
  config: BarkConfig,
  payload: NotificationPayload
): Promise<SendResult> {
  const { deviceKey, server = "https://api.day.app", group, sound, icon, badge } = config;

  if (!deviceKey) {
    return { ok: false, channel: "bark", error: "deviceKey is required" };
  }

  // Validate server URL to prevent SSRF
  try {
    assertSafePublicUrl(server);
  } catch (err: any) {
    return { ok: false, channel: "bark", error: `Invalid Bark server: ${err.message}` };
  }

  if (
    (typeof process !== "undefined" && process.env?.MOCK_EXTERNAL_API === "true")
  ) {
    return { ok: true, channel: "bark", messageId: `bark_mock_${Date.now()}` };
  }

  const cleanServer = server.replace(/\/+$/, "");
  const url = `${cleanServer}/push`;

  // Bark 经 APNs 转发，整个 payload 约 4KB。超限时 APNs 静默丢包，
  // 客户端**收不到任何通知**（连失败回调都没有）—— 比报错更难排查。
  //
  // 标题与正文分开截断：先把各自压到限额内，再留出其余字段的余量。
  // 早期版本只截正文，标题超长时仍会顶爆总包。
  const HEADROOM = 1024; // device_key / url / sound / icon 等固定开销的保守估计
  const perField = Math.max(200, PLATFORM_LIMITS.bark.maxLength - HEADROOM);
  const body: Record<string, any> = {
    device_key: deviceKey,
    // 必须按**字节**截：2000 个中文字符只有 2000 个字符（看着远没超限），
    // 但字节数是 6000，早已越过 4KB 上限。按字符截会漏掉这类内容。
    title: truncateForPlatform(payload.title, perField, "…", PLATFORM_LIMITS.bark.unit),
    body: truncateForPlatform(
      payload.message,
      perField,
      "\n\n[Content truncated due to platform size limit]",
      PLATFORM_LIMITS.bark.unit,
    ),
    level: payload.level === "alert" ? "critical" : payload.level === "warning" ? "timeSensitive" : "active",
  };

  if (group) body.group = group;
  if (sound) body.sound = sound;
  if (icon) body.icon = icon;
  if (badge !== undefined) body.badge = badge;
  if (payload.link) body.url = payload.link;

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
    body: JSON.stringify(body),
    signal: outboundSignal,
    redirect: "manual",
  });
  } catch (err) {
    return {
      ok: false,
      channel: "bark",
      error: `网络请求失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return {
      ok: false,
      channel: "bark",
      error: `Bark API error (${res.status}): ${errText}`,
    };
  }

  // 解析响应体并校验业务状态码。
  // 历史实现只看 HTTP 状态：HTTP 200 但 body 里 { code: 400, message: "failed" }
  // 也会被判为投递成功 —— 告警静默丢失且无任何信号。
  const data: any = await res.json().catch(() => null);
  if (!data || typeof data !== "object") {
    return { ok: false, channel: "bark", error: "Bark 返回了非 JSON 响应体" };
  }
  // 业务字段**缺失**同样判失败。
  //
  // 原判定是 `data.code !== undefined && Number(data.code) !== 200` ——
  // 于是 HTTP 200、响应体为 `{}` 时条件为假，落到最后 return ok:true。
  // 那意味着"代理截断 / WAF 改写 / 第三方改协议"这类异常会被上报为投递成功，
  // 与本函数上一段注释想防的正是同一类问题。Bark 的成功响应必然带 code:200，
  // 因此要求字段存在是安全的。
  if (data.code === undefined || Number(data.code) !== 200) {
    return {
      ok: false,
      channel: "bark",
      error: `Bark API error: ${data.message ?? data.code}`,
    };
  }
  return { ok: true, channel: "bark", messageId: String(data.id ?? `bark_${Date.now()}`) };
}
