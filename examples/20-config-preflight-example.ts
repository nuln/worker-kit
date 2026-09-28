/**
 * Example 20: 部署预检（fail-closed 配置检查）
 *
 * 演示：
 * 1. 在 Worker 入口做一次启动自检，缺配置直接返回 503
 * 2. 用 `assertConfigured` 在单个能力内部做兜底（不经 HTTP 的调用方也适用）
 * 3. 错误响应遵循 AGENTS §7.1 契约，且**不含任何密钥值**
 *
 * ## 为什么要做这件事
 *
 * Worker 的绑定与密钥缺失**不会**在部署时报错：wrangler 照常发布，代码照常
 * 接收请求。更糟的是"缺了也不报错"的路径 —— 只在后台打一行 warn，生产根本
 * 看不到，于是配置缺陷静默存在：
 *
 * - 忘注入 `AUTH_SESSION_DO_SECRET` → DO 的 HTTP 入口无鉴权（凭据可被匿名读取）
 * - 忘绑定 `RATE_LIMITER_DO`         → 限流完全失效，监控面板一片绿
 * - 忘配 `RESEND_API_KEY`            → 密码重置「假成功」，用户以为收到了邮件
 *
 * 这三类都属于"必须在请求到达用户之前就暴露"的问题。
 */

import { preflight, preflightGuard, assertConfigured, ConfigError } from "@nuln/worker-kit/config";

/**
 * Worker 入口的标准写法。
 *
 * @returns 通过时返回 `null`；缺失配置时返回 503 响应
 */
export function startupGuard(env: any, serviceName = "service") {
  return preflightGuard(
    env,
    {
      secrets: {
        COOKIE_SECRET: "会话 Cookie 的 HMAC 签名密钥",
        AUTH_SESSION_DO_SECRET: "AuthSessionDO 的 HTTP 入口鉴权密钥",
      },
      bindings: {
        DB: "D1 数据库绑定",
      },
      vars: {
        // WebAuthn 的 RP ID 与 Origin 锚点：未配置时验签会 fail-closed 拒绝
        RP_ID: "WebAuthn RP ID（如 auth.nuln.net）",
        ORIGIN: "WebAuthn Origin 白名单（缺失等于零校验，已 fail-closed）",
      },
      apiKeys: {
        RESEND_API_KEY: "邮件投递（缺失会导致密码重置假成功）",
      },
    },
    serviceName,
  );
}

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    // ① 入口自检：缺什么直接 503，并把缺失清单告诉运维
    const denied = startupGuard(env, "tower");
    if (denied) return denied;

    // ② 业务处理
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  },
};

/**
 * 能力内部的兜底自检。
 *
 * 入口自检是"第一道防线"，但调用方可能忘记调用；因此每个需要外部依赖的
 * 能力在**被使用的那一刻**也做一次检查。两者共用同一套原语，不会出现
 * "两处标准不一致"。
 *
 * @throws {ConfigError} 依赖缺失
 */
export function requireMailConfigured(env: any): void {
  assertConfigured(
    env,
    {
      RESEND_API_KEY: "邮件投递；缺失会导致密码重置 / 邮箱验证「假成功」",
    },
    "apiKey",
    "mail",
  );
}

/** 只报告不阻断的用法：适合管理后台展示"还缺什么"。 */
export function auditConfig(env: any) {
  const report = preflight(
    env,
    {
      secrets: { COOKIE_SECRET: "会话签名" },
      bindings: { DB: "D1", R2: "对象存储", KV: "KV" },
      vars: { ORIGIN: "WebAuthn Origin 锚点" },
    },
    "tower",
  );
  console.log(report.summary);
  for (const p of report.problems) {
    console.error(`  [${p.kind}] ${p.name}: ${p.reason}\n    → ${p.hint}`);
  }
  return report;
}

/** 演示 ConfigError 的结构（可安全记录到日志）。 */
export function describeConfigError(err: unknown): string {
  if (err instanceof ConfigError) {
    // problems 中只含名称 / 原因 / 指引，绝不含密钥值，可安全落日志
    return err.problems.map((p) => `${p.kind}:${p.name} → ${p.hint}`).join("\n");
  }
  return String(err);
}
