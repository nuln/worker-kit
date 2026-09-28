/**
 * Example 09: 跨环境邮件投递与收件人清洗
 *
 * 演示：
 * 1. 按环境动态选择邮件 Provider（Resend / Webhook / Console）
 * 2. 清洗逗号/分号分隔的收件人列表（`toRecipients`）
 * 3. 通过 notify 通道发送事务性与验证类邮件
 *
 * ## 两个容易踩的点
 *
 * 1. `sendEmail` 属于 **notify 通道**（`EmailChannelConfig` + `NotificationPayload`），
 *    与 `email` 模块的 `EmailProvider`（`{ to, subject, text }`）是**两套不同
 *    的 API**，不要混用。
 * 2. 未配置任何发信服务时 `createEmailProvider` 会回落到 Console provider
 *    （只打日志）。**密码重置、邮箱验证等安全关键流程不能依赖它** ——
 *    必须确保 `RESEND_API_KEY` 或 `EMAIL_WEBHOOK_URL` 已正确配置。
 */

import { createEmailProvider, toRecipients } from "@nuln/worker-kit";
import { sendEmail } from "@nuln/worker-kit/notify";

export async function runEmailExample(env: any) {
  console.log("=== [Example 09] Email Dispatching & Sanitization ===");

  // 1. 清洗逗号/分号分隔的收件人列表，剔除空项与无法提取的部分
  const recipients = toRecipients(" admin@nuln.net, user1@nuln.net ; ");
  console.log("Sanitized Recipients:", recipients);

  // 2. 按环境创建 provider（Resend → Webhook → Console 依次回退）
  const provider = createEmailProvider(env);
  console.log("Provider:", provider.constructor.name);

  // 3. 直接用 provider 发送事务性邮件
  await provider.send({
    to: recipients,
    subject: "Your Passkey has been successfully registered",
    text: "Hello! A new hardware security key was added to your account.",
    html: "<p>Hello! A new <b>Passkey</b> was added to your account.</p>",
  });

  // 4. 走 notify 通道发送（可附加告警级别的结构化载荷）
  const result = await sendEmail(
    { to: "user1@nuln.net", subject: "登录提醒", from: "noreply@nuln.net" },
    {
      title: "新设备登录",
      message: "检测到新 Passkey 登录：Safari on macOS",
      level: "info",
      event: "login",
    },
    env,
  );

  console.log("Email Dispatch Result:", result);
  return result;
}

/**
 * 投递前的配置自检 —— 避免"假成功"。
 *
 * `isEmailConfigured` 只检查配置项是否存在，不校验可达性；真正的兜底应在
 * 业务侧：安全关键流程若未配置发信服务，应当**显式失败**而不是提示用户
 * "邮件已发送"。
 */
export function assertMailConfigured(env: any): void {
  const hasWebhook =
    typeof env?.EMAIL_WEBHOOK_URL === "string" && env.EMAIL_WEBHOOK_URL.startsWith("http");
  const hasResend = typeof env?.RESEND_API_KEY === "string" && env.RESEND_API_KEY.length > 0;
  if (!hasWebhook && !hasResend) {
    throw new Error(
      "未配置发信服务：密码重置 / 邮箱验证会「假成功」（邮件只打到控制台）。" +
        "请配置 RESEND_API_KEY 或 EMAIL_WEBHOOK_URL。",
    );
  }
}
