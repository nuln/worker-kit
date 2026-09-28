/**
 * @nuln/worker-kit/notify/drivers/email
 */

import type { NotificationPayload, EmailChannelConfig, SendResult } from "../types.js";
import { formatToHtml, formatToText } from "../formatters.js";
import { createEmailProvider, getDefaultFromEmail } from "../../email/index.js";

export async function sendEmail(
  config: EmailChannelConfig,
  payload: NotificationPayload,
  env: any = {}
): Promise<SendResult> {
  const { to, subject, from } = config;

  if (!to) {
    return { ok: false, channel: "email", error: "Recipient email 'to' is required" };
  }

  const emailSubject = subject || payload.title;
  const text = formatToText(payload);
  const html = formatToHtml(payload);
  const fromAddress = from || getDefaultFromEmail(env);

  try {
    const provider = createEmailProvider({
      ...env,
      EMAIL_FROM: fromAddress,
    });

    await provider.send({
      to,
      subject: emailSubject,
      text,
      html,
    });

    return { ok: true, channel: "email", messageId: `email_${Date.now()}` };
  } catch (err: any) {
    return {
      ok: false,
      channel: "email",
      error: `Email delivery failed: ${err?.message || String(err)}`,
    };
  }
}
