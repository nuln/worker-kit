/**
 * @nuln/worker-kit/email
 *
 * 统一多通道边缘邮件发信引擎
 * 支持：Mail Webhook RPC / Resend HTTP API / Console 模拟 / 自适应发件人与收件人格式化
 */

export interface EmailMessage {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
}

export interface EmailProvider {
  send(msg: EmailMessage): Promise<void>;
}

/** 规范化收件人字段（支持逗号/空格分隔、带名字格式 `Name <addr>`、数组、去重） */
export function toRecipients(v: unknown): string[] {
  if (v == null) return [];
  const input = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  for (const item of input) {
    if (item == null) continue;
    const segments = String(item).split(/[,;]+/);
    for (let seg of segments) {
      seg = seg.trim();
      if (!seg) continue;
      if (/<[^>]*@[^>]*>/.test(seg) || !/\s/.test(seg)) {
        out.push(seg);
      } else {
        out.push(...seg.split(/\s+/).filter(Boolean));
      }
    }
  }
  return [...new Set(out)];
}

/** 计算默认系统发件人（根据当前访问域名或环境变量动态自适应） */
export function getDefaultFromEmail(env: Record<string, unknown> = {}, domainHost = ""): string {
  if (domainHost) {
    return `noreply@${domainHost.trim().toLowerCase()}`;
  }
  const rawDomains = env?.DOMAINS || env?.SEED_DOMAIN || env?.EMAIL_FROM || "localhost";
  const primary = String(rawDomains).split(",")[0].trim().toLowerCase() || "localhost";
  if (primary.includes("@")) return primary;
  return `noreply@${primary}`;
}

/** 开发/测试环境：仅标准输出打印（不实际联网发信） */
export class ConsoleEmailProvider implements EmailProvider {
  async send(msg: EmailMessage): Promise<void> {
    const toStr = Array.isArray(msg.to) ? msg.to.join(", ") : msg.to;
    console.log(`[email] -> ${toStr} | ${msg.subject}\n${msg.text}`);
  }
}

/** 生产用：Resend 官方 HTTP API 直连发信 */
export class ResendEmailProvider implements EmailProvider {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}

  async send(msg: EmailMessage): Promise<void> {
    const recipients = toRecipients(msg.to);
    // 仅接受**显式**开关 MOCK_EXTERNAL_API 作为测试替身。
    // 曾有的 `apiKey.startsWith("mock_")` 属于子串猜测：一旦线上密钥以
    // "mock_" 开头，所有发信会静默变成日志输出并报告成功。
    if (typeof process !== "undefined" && process.env?.MOCK_EXTERNAL_API === "true") {
      console.log(`[mock-email-resend] -> ${recipients.join(", ")} | ${msg.subject}`);
      return;
    }
    // 出站加固：5s 超时 + 禁止自动跟随重定向（302 跳内网会绕过前置校验）
    const res = await fetch("https://api.resend.com/emails", {
      signal: AbortSignal.timeout(5000),
      redirect: "manual",
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        from: this.from,
        to: recipients,
        subject: msg.subject,
        text: msg.text,
        html: msg.html || undefined,
        headers: msg.headers || undefined,
      }),
    });
    if (!res.ok) {
      throw new Error(`Resend email delivery failed: ${res.status} ${await res.text()}`);
    }
  }
}

/** 生产用：POST 到外部发信网关（Mail Webhook / Cloudflare Email Routing / Mailchannels / SMTP 网关） */
export class HttpEmailProvider implements EmailProvider {
  constructor(
    private url: string,
    private from: string,
    private apiKey?: string,
  ) {}

  async send(msg: EmailMessage): Promise<void> {
    const recipients = toRecipients(msg.to);
    // 曾经的 mock 判定是 `this.url.includes("mock")` / `apiKey.startsWith("mock_")`
    // —— 基于**子串猜测**是否处于测试环境。`https://mail-api.example.com/mock/v1/send`
    // 这类把 mock 放在路径里的生产命名会命中该分支：只打一行日志然后 resolve，
    // 即"发送成功"。账号恢复流程据此向用户显示"重置链接已发送"，而邮件从未
    // 离开进程。测试替身改为显式的 {@link ConsoleEmailProvider}，此处不再猜测。
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
      headers["X-API-Key"] = this.apiKey;
    }
    try {
      const res = await fetch(this.url, {
        // 与 ResendEmailProvider 保持同一口径的出站加固：
        // 5s 超时（否则对端挂起会永久占用请求）+ 禁止自动重定向
        // （默认 follow 会让公网地址 302 跳到内网，使前置的 URL 校验形同虚设）。
        //
        // 这两项此前只加在 Resend 驱动上，本驱动被漏掉 —— 而它正是
        // `EMAIL_WEBHOOK_URL` 场景下实际生效的那条路径。
        signal: AbortSignal.timeout(5000),
        redirect: "manual",
        method: "POST",
        headers,
        body: JSON.stringify({
          from: this.from,
          to: recipients.length === 1 ? recipients[0] : recipients,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          headers: msg.headers,
        }),
      });
      if (!res.ok) {
        throw new Error(`email webhook failed: ${res.status} ${await res.text()}`);
      }
    } catch (err: any) {
      if (typeof process !== "undefined" && process.env?.MOCK_EXTERNAL_API === "true") {
        console.log(`[mock-email-fallback] Webhook unreachable, fallback mock -> ${recipients.join(", ")} | ${msg.subject}`);
        return;
      }
      throw err;
    }
  }
}

export interface EmailEnv {
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  EMAIL_WEBHOOK_URL?: string;
  EMAIL_API_KEY?: string;
  RESEND_API_KEY?: string;
  MOCK_EXTERNAL_API?: string | boolean;
  DOMAINS?: string;
  SEED_DOMAIN?: string;
}

/** 工厂函数：自动根据环境变量选型并构造 EmailProvider 实例 */
/** 「未配置发信服务」告警去重标记：只提示一次，避免每次调用刷屏。 */
let warnedEmailUnconfigured = false;

export function createEmailProvider(env: EmailEnv): EmailProvider {
  const from =
    env.EMAIL_FROM && !env.EMAIL_FROM.includes("REPLACE_WITH_")
      ? env.EMAIL_FROM
      : "no-reply@oidc.local";

  // 1. Mail 服务 Webhook / 发信网关优先 (EMAIL_WEBHOOK_URL)
  const webhookUrl = env.EMAIL_WEBHOOK_URL;
  if (
    webhookUrl &&
    webhookUrl.startsWith("http") &&
    !webhookUrl.includes("REPLACE_WITH_")
  ) {
    return new HttpEmailProvider(
      webhookUrl,
      from,
      env.EMAIL_API_KEY && !env.EMAIL_API_KEY.includes("REPLACE_WITH_")
        ? env.EMAIL_API_KEY
        : undefined,
    );
  }

  // 2. Resend 官方发信 API (后备)
  if (
    env.RESEND_API_KEY &&
    !env.RESEND_API_KEY.includes("REPLACE_WITH_")
  ) {
    return new ResendEmailProvider(env.RESEND_API_KEY, from);
  }

  if (env.MOCK_EXTERNAL_API === "true" || env.MOCK_EXTERNAL_API === true) {
    return new ConsoleEmailProvider();
  }

  if (env.EMAIL_PROVIDER && env.EMAIL_PROVIDER !== "console") {
    console.warn(`unknown EMAIL_PROVIDER=${env.EMAIL_PROVIDER}, falling back to console`);
  }
  // 未配置任何发信服务：返回 console provider 只打日志。
  //
  // 兜底本身是合理的（不让路由 500），但**必须显式告警** —— 密码重置、邮箱
  // 验证这类安全关键流程在生产漏配时会"假成功"：用户收到"邮件已发送"，
  // 实际什么都没发，且无任何错误信号。
  if (!warnedEmailUnconfigured) {
    warnedEmailUnconfigured = true;
    console.error(
      "[email] 未配置任何发信服务（EMAIL_WEBHOOK_URL / RESEND_API_KEY / EMAIL_PROVIDER 均为空）：" +
        "所有邮件将只输出到控制台而不会真正投递。密码重置与邮箱验证会出现「假成功」。",
    );
  }
  return new ConsoleEmailProvider();
}

/** 检查当前环境是否有效配置了发信服务（Mail Webhook / Resend / Mock / Console） */
export function isEmailConfigured(env: unknown): boolean {
  if (!env || typeof env !== "object") {
    return typeof process !== "undefined" && (process.env?.NODE_ENV === "test" || process.env?.MOCK_EXTERNAL_API === "true");
  }
  const e = env as Record<string, unknown>;
  if (e.MOCK_EXTERNAL_API === "true" || e.MOCK_EXTERNAL_API === true) return true;
  if (e.EMAIL_PROVIDER === "console") return true;
  if (e.EMAIL_CONFIGURED === "false" || e.EMAIL_CONFIGURED === false) return false;
  const hasWebhook =
    typeof e.EMAIL_WEBHOOK_URL === "string" &&
    e.EMAIL_WEBHOOK_URL.trim().startsWith("http") &&
    !e.EMAIL_WEBHOOK_URL.includes("REPLACE_WITH_");
  const hasResend =
    typeof e.RESEND_API_KEY === "string" &&
    e.RESEND_API_KEY.trim().length > 0 &&
    !e.RESEND_API_KEY.includes("REPLACE_WITH_");
  if (hasWebhook || hasResend) return true;
  return typeof process !== "undefined" && (process.env?.NODE_ENV === "test" || process.env?.MOCK_EXTERNAL_API === "true") && e.EMAIL_CONFIGURED !== "false";
}
