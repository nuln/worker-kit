/**
 * @nuln/worker-kit/notify/formatters
 *
 * 跨平台通知消息格式化器
 */

import type { NotificationPayload } from "./types.js";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTimestamp(ts?: number): string {
  const date = ts ? new Date(ts) : new Date();
  return date.toISOString().replace("T", " ").replace(/\..+/, " UTC");
}

/**
 * 格式化为纯文本 Text
 */
export function formatToText(payload: NotificationPayload): string {
  const lines: string[] = [payload.title, "", payload.message];

  if (payload.details && Object.keys(payload.details).length > 0) {
    lines.push("");
    for (const [k, v] of Object.entries(payload.details)) {
      if (v !== undefined && v !== null && v !== "") {
        lines.push(`${k}: ${v}`);
      }
    }
  }

  lines.push("", `Time: ${formatTimestamp(payload.timestamp)}`);

  if (payload.link) {
    lines.push(`Link: ${payload.link}`);
  }

  return lines.join("\n");
}

/**
 * 格式化为通用 Markdown
 */
export function formatToMarkdown(payload: NotificationPayload): string {
  const icon =
    payload.level === "alert" ? "🚨 " : payload.level === "warning" ? "⚠️ " : "ℹ️ ";
  const lines: string[] = [`### ${icon}${payload.title}`, "", payload.message];

  if (payload.details && Object.keys(payload.details).length > 0) {
    lines.push("", "---");
    for (const [k, v] of Object.entries(payload.details)) {
      if (v !== undefined && v !== null && v !== "") {
        lines.push(`- **${k}**: \`${v}\``);
      }
    }
  }

  lines.push("", `> 🕒 *${formatTimestamp(payload.timestamp)}*`);

  if (payload.link) {
    lines.push(`\n[🔗 查看详情 / View Details](${payload.link})`);
  }

  return lines.join("\n");
}

/**
 * 格式化为 Telegram 兼容的 HTML 格式
 */
export function formatToTelegramHtml(payload: NotificationPayload): string {
  const icon =
    payload.level === "alert" ? "🚨 " : payload.level === "warning" ? "⚠️ " : "ℹ️ ";
  const lines: string[] = [
    `<b>${icon}${escapeHtml(payload.title)}</b>`,
    "",
    escapeHtml(payload.message),
  ];

  if (payload.details && Object.keys(payload.details).length > 0) {
    lines.push("");
    for (const [k, v] of Object.entries(payload.details)) {
      if (v !== undefined && v !== null && v !== "") {
        lines.push(
          `• <b>${escapeHtml(k)}</b>: <code>${escapeHtml(String(v))}</code>`
        );
      }
    }
  }

  lines.push("", `<i>🕒 ${formatTimestamp(payload.timestamp)}</i>`);

  if (payload.link) {
    lines.push(`<a href="${escapeHtml(payload.link)}">🔗 查看详情 / View Details</a>`);
  }

  return lines.join("\n");
}

/**
 * 格式化为企业微信群机器人 Markdown 格式
 */
export function formatToWeComMarkdown(payload: NotificationPayload): string {
  const color =
    payload.level === "alert"
      ? "warning"
      : payload.level === "warning"
      ? "comment"
      : "info";
  const lines: string[] = [
    `<font color="${color}">### ${payload.title}</font>`,
    "",
    payload.message,
  ];

  if (payload.details && Object.keys(payload.details).length > 0) {
    lines.push("");
    for (const [k, v] of Object.entries(payload.details)) {
      if (v !== undefined && v !== null && v !== "") {
        lines.push(`> **${k}**: <font color="comment">${v}</font>`);
      }
    }
  }

  lines.push("", `> 时间: <font color="comment">${formatTimestamp(payload.timestamp)}</font>`);

  if (payload.link) {
    lines.push(`\n[查看详情](${payload.link})`);
  }

  return lines.join("\n");
}

/**
 * 格式化为飞书 Webhook 交互卡片或富文本消息
 */
export function formatToFeishuCard(payload: NotificationPayload): Record<string, any> {
  const templateColor =
    payload.level === "alert" ? "red" : payload.level === "warning" ? "orange" : "blue";

  const elements: any[] = [
    {
      tag: "div",
      text: {
        tag: "lark_md",
        content: payload.message,
      },
    },
  ];

  if (payload.details && Object.keys(payload.details).length > 0) {
    const detailLines: string[] = [];
    for (const [k, v] of Object.entries(payload.details)) {
      if (v !== undefined && v !== null && v !== "") {
        detailLines.push(`**${k}**: \`${v}\``);
      }
    }
    if (detailLines.length > 0) {
      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: detailLines.join("\n"),
        },
      });
    }
  }

  elements.push({
    tag: "note",
    elements: [
      {
        tag: "plain_text",
        content: `🕒 ${formatTimestamp(payload.timestamp)}`,
      },
    ],
  });

  if (payload.link) {
    elements.push({
      tag: "action",
      actions: [
        {
          tag: "button",
          text: {
            tag: "plain_text",
            content: "查看详情 / Details",
          },
          type: "primary",
          url: payload.link,
        },
      ],
    });
  }

  return {
    msg_type: "interactive",
    card: {
      header: {
        title: {
          tag: "plain_text",
          content: payload.title,
        },
        template: templateColor,
      },
      elements,
    },
  };
}

/**
 * 格式化为响应式自适应 HTML 邮件模版（极简灰白 Charcoal Slate 风格）
 */
export function formatToHtml(payload: NotificationPayload): string {
  const accentColor =
    payload.level === "alert"
      ? "#ef4444"
      : payload.level === "warning"
      ? "#f59e0b"
      : "#3b82f6";

  let detailsHtml = "";
  if (payload.details && Object.keys(payload.details).length > 0) {
    const rows: string[] = [];
    for (const [k, v] of Object.entries(payload.details)) {
      if (v !== undefined && v !== null && v !== "") {
        rows.push(`
          <tr>
            <td style="padding: 6px 12px; color: #64748b; font-size: 13px; font-weight: 500; border-bottom: 1px solid #f1f5f9; width: 35%;">${escapeHtml(k)}</td>
            <td style="padding: 6px 12px; color: #0f172a; font-size: 13px; font-family: monospace; border-bottom: 1px solid #f1f5f9;">${escapeHtml(String(v))}</td>
          </tr>
        `);
      }
    }
    if (rows.length > 0) {
      detailsHtml = `
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #f8fafc; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0;">
          <tbody>
            ${rows.join("")}
          </tbody>
        </table>
      `;
    }
  }

  let buttonHtml = "";
  if (payload.link) {
    buttonHtml = `
      <div style="margin-top: 20px; text-align: center;">
        <a href="${escapeHtml(payload.link)}" style="display: inline-block; background: #0f172a; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 13px; font-weight: 500;">
          查看详情 / View Details
        </a>
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(payload.title)}</title>
</head>
<body style="margin: 0; padding: 24px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; padding: 24px 28px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
    <div style="border-left: 4px solid ${accentColor}; padding-left: 12px; margin-bottom: 16px;">
      <h2 style="margin: 0; font-size: 17px; font-weight: 600; color: #0f172a; letter-spacing: -0.01em;">${escapeHtml(payload.title)}</h2>
    </div>
    <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.6; color: #334155;">
      ${escapeHtml(payload.message)}
    </p>
    ${detailsHtml}
    ${buttonHtml}
    <div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8;">
      ${formatTimestamp(payload.timestamp)} &bull; Nuln Cloudflare Security Guard
    </div>
  </div>
</body>
</html>`;
}
