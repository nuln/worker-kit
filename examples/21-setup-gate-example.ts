/**
 * Example 21: 初始化前置检查（Setup Gate）
 *
 * 演示：
 * 1. 用**纯数据**声明本服务需要哪些环境变量
 * 2. `/setup` 页在缺配置时显示"需要配置什么"而不是初始化表单
 * 3. 初始化 API 在缺配置时返回 503（与页面判定口径一致）
 * 4. **加环境变量只改数据，不改代码**
 *
 * ## 为什么要这样
 *
 * 过去首次访问 `/setup` 时，无论配置是否齐全都照常渲染初始化表单 ——
 * 用户填完邮箱、绑完 Passkey，才在后续请求上炸掉；或者更糟的"假成功"
 * （邮件只打到控制台、限流根本没生效）。
 *
 * 现在页面会先评估依赖，缺什么就先显示什么。
 */

import { renderAuthPage, authPageResponse } from "@nuln/worker-kit";
import {
  defineRequirements,
  evaluateRequirements,
  REQUIREMENTS,
  type Requirements,
} from "@nuln/worker-kit/config";

/**
 * 本服务的初始化前置需求。
 *
 * 全部是**数据**：加一个环境变量 = 往下加一行，页面与 API 拦截自动生效，
 * 不需要改任何渲染 / 校验代码。
 */
export const requirements: Requirements = defineRequirements(
  // ── kit 内置预设，按能力组合 ──
  REQUIREMENTS.passkey,   // RP_ID + ORIGIN（WebAuthn 反钓鱼锚点）
  REQUIREMENTS.session,   // COOKIE_SECRET + AUTH_SESSION_DO_SECRET
  REQUIREMENTS.ratelimit, // RATE_LIMITER_DO（缺失时限流 fail-closed）
  REQUIREMENTS.database,  // DB

  // ── 本服务特有 ──
  { name: "ADMIN_EMAIL", kind: "var", why: "初始管理员邮箱（缺省时由使用者现场录入）" },
  {
    name: "SMTP_HOST",
    kind: "var",
    why: "自建邮件服务器；改用 Resend 时可移除本项",
    required: false, // 建议项：缺失不阻断初始化
  },
);

/**
 * 渲染 `/setup`。
 *
 * @param env Worker 环境对象 —— 传入后页面会先评估 `requirements`
 */
export function handleSetupPage(request: Request, env: any): Response {
  return authPageResponse(
    {
      view: "setup",
      serviceName: "Tower",
      basePath: "/tower",
      request,
      env,
      requirements,
    },
    // 缺配置时仍返回 200：用户需要在浏览器里看到"缺什么"，
    // 返回 4xx/5xx 会让页面变成一坨错误信息。
    { status: 200 },
  );
}

/**
 * 初始化 API 的前置闸门。
 *
 * 与页面**共用同一套判定**（`evaluateRequirements`）—— 页面显示什么，
 * API 就拦什么，不会出现"页面能过但 API 拒绝"或反之的不一致。
 *
 * @returns 放行返回 `null`；缺配置返回 503 响应（含缺失清单）
 */
export function setupApiGuard(env: any): Response | null {
  const gate = evaluateRequirements(env, requirements);
  if (gate.ok) return null;

  return new Response(
    JSON.stringify({
      ok: false,
      error: "service_not_configured",
      code: "CONFIG_MISSING",
      details: gate.blocking.map((p) => ({
        kind: p.kind,
        name: p.name,
        reason: p.reason,
        hint: p.hint,
      })),
    }),
    {
      status: 503,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    },
  );
}

/** 完整的初始化 API 处理器。 */
export async function handleSetupApi(request: Request, env: any, register: (r: any) => Promise<Response>) {
  const denied = setupApiGuard(env);
  if (denied) return denied;
  return register(await request.json().catch(() => ({})));
}

/**
 * 以后新增一个环境变量：**只加一行数据**。
 *
 * 页面与 API 拦截无需任何改动 —— 判定与渲染都是遍历数据。
 */
export const requirementsV2: Requirements = defineRequirements(
  requirements,
  REQUIREMENTS.mail,   // RESEND_API_KEY —— 缺失会导致密码重置「假成功」
  { name: "SMTP_HOST", kind: "var", why: "自建邮件服务器", required: false },
);

/** 打印当前缺什么（适合放进管理后台或部署脚本）。 */
export function reportMissing(env: any): string {
  const gate = evaluateRequirements(env, requirementsV2);
  if (gate.ok) return "配置完整，可以初始化";
  return gate.all
    .map((p) => `  [${p.kind}] ${p.name}: ${p.reason}\n    → ${p.hint}`)
    .join("\n");
}

/** 直接看渲染出的清单页（便于人工核对）。 */
export function previewSetupPage(env: any, lang: "zh" | "en" = "zh"): string {
  return renderAuthPage({
    view: "setup",
    serviceName: "Tower",
    basePath: "/tower",
    env,
    requirements: requirements,
    lang,
  });
}
