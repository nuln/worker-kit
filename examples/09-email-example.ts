/**
 * Example 09: Cross-Environment Email Dispatching & Sanitization
 *
 * Demonstrates:
 * 1. Selecting Email Provider dynamically (Resend vs Webhook vs Local Console)
 * 2. Sanitizing multiple recipient email addresses
 * 3. Sending transactional and verification emails
 */

import { createEmailProvider, sendEmail, normalizeEmailList } from "@nuln/worker-kit";

export async function runEmailExample(env: any) {
  console.log("=== [Example 09] Email Dispatching & Sanitization ===");

  // 1. Normalize comma-separated recipient emails
  const recipients = normalizeEmailList(" admin@nuln.net, user1@nuln.net ; invalid-email ");
  console.log("Sanitized Recipients:", recipients);

  // 2. Create provider
  const provider = createEmailProvider(env);

  // 3. Dispatch Email
  const success = await sendEmail(provider, {
    to: recipients,
    from: "noreply@nuln.net",
    subject: "Your Passkey has been successfully registered",
    text: "Hello! A new hardware security key was added to your account.",
    html: "<p>Hello! A new <b>Passkey</b> was added to your account.</p>",
  });

  console.log("Email Dispatch Result:", success);
}
