/**
 * @nuln/worker-kit/config — 部署配置检查（Preflight）
 *
 * ## 为什么需要这个模块
 *
 * Worker 的绑定与密钥缺失**不会**在启动时抛错：wrangler 照常部署，代码照常
 * 接收请求，直到某条执行到 `env.SOMETHING_KV.get(...)` 才在运行期炸掉。更糟的
 * 是那些"缺了也不报错"的路径 —— 只在后台 `console.warn` 一行，生产环境根本
 * 看不到，于是**配置缺陷静默存在**：
 *
 * - 忘了注入 `AUTH_SESSION_DO_SECRET` → DO 的 HTTP 入口无鉴权
 * - 忘了绑定 `RATE_LIMITER_DO` → 限流完全失效，监控看不出来
 * - 忘了配 `RESEND_API_KEY` → 密码重置「假成功」，用户以为收到了邮件
 *
 * 这些都属于"必须在请求到达用户之前就暴露"的问题。本模块提供统一的检查原语：
 * **发现缺失就抛错 / 返回 503，而不是打一行日志继续跑**。
 *
 * ## 用法
 *
 * ### 1. 在 Worker 入口做一次启动自检（推荐）
 *
 * ```ts
 * import { preflight } from "@nuln/worker-kit/config";

 *
 * export default {
 *   async fetch(request, env) {
 *     const report = preflight(env, {
 *       secrets:   { AUTH_SESSION_DO_SECRET: "会话 DO 的 HTTP 入口鉴权密钥" },
 *       bindings:  { RATE_LIMITER_DO: "DurableObjectNamespace", DB: "D1Database" },
 *       vars:      { ORIGIN: { required: true, why: "WebAuthn origin 锚点" } },
 *     });
 *     if (!report.ok) return configErrorResponse(report);   // 503 + 缺失清单
 *     …
 *   },
 * };
 * ```
 *
 * ### 2. 在具体能力内部做 fail-closed 兜底
 *
 * 各模块在自身入口也会调用同一套原语（见 `session/do.ts`、`ratelimit/index.ts`、
 * `email/index.ts`），这样即使调用方忘了在入口自检，缺配置也会在**该能力被
 * 使用的那一刻**明确报错，而不是静默降级。
 *
 * @packageDocumentation
 */

// ConfigKind / ConfigProblem 抽到独立文件：requirements.ts 需要它们，
// 而 index.ts 又 `export * from "./requirements.js"` —— 同处一文件时形成
// 运行时循环依赖。类型抽离后 requirements 只依赖 types，环即断开，
// 且对外导出路径完全不变。
import type { ConfigKind, ConfigProblem } from "./types.js";

export type { ConfigKind, ConfigProblem } from "./types.js";

/** 配置项类别，决定缺失时的提示措辞与严重级别。 */

/** 某一项的声明。 */
export interface ConfigSpecItem {
  /** 为什么需要它 —— 会出现在错误信息里，帮助运维快速定位 */
  why: string;
  /** 缺了是否阻断（默认 true） */
  required?: boolean;
  /** 自定义检查：返回 false 表示不合格 */
  check?: (value: unknown) => boolean;
  /** 自定义修复指引 */
  hint?: string;
}

/** 一组声明。 */
export type ConfigSpec = Record<string, ConfigSpecItem | string>;

/** 预检报告。 */
export interface ConfigReport {
  ok: boolean;
  problems: ConfigProblem[];
  /** 便于日志与告警 */
  summary: string;
}

/** 配置检查失败时抛出。携带完整问题清单，便于上层转成 HTTP 响应。 */
export class ConfigError extends Error {
  readonly problems: ConfigProblem[];
  readonly report: ConfigReport;

  constructor(problems: ConfigProblem[], scope = "configuration") {
    const lines = problems.map((p) => `  - [${p.kind}] ${p.name}: ${p.reason}\n    ${p.hint}`);
    super(
      `Missing or invalid ${scope} (${problems.length} problem(s)):\n${lines.join("\n")}`,
    );
    this.name = "ConfigError";
    this.problems = problems;
    this.report = { ok: false, problems, summary: `${problems.length} problem(s)` };
  }
}

const KIND_HINT: Record<ConfigKind, string> = {
  secret: "wrangler secret put <NAME>",
  var: "在 wrangler.jsonc 的 vars 或 .dev.vars 中配置",
  binding: "在 wrangler.jsonc 的对应节点声明该绑定",
  apiKey: "在 .dev.vars.prod 中配置并执行 npm run secrets:prod:<service>",
};

function normalizeSpec(spec: ConfigSpec): Record<string, ConfigSpecItem> {
  const out: Record<string, ConfigSpecItem> = {};
  for (const [k, v] of Object.entries(spec ?? {})) {
    out[k] = typeof v === "string" ? { why: v } : v;
  }
  return out;
}

/** 判定一个值是否"存在且非空"。 */
function present(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

/**
 * 检查一组声明，返回问题清单（不抛错）。
 *
 * @param env Worker 环境对象
 * @param spec 声明的键 → 用途说明 / 详细声明
 * @param kind 该组的类别，影响提示措辞
 * @param scope 出错时的范围名（如服务名），便于定位
 */
export function inspect(
  env: unknown,
  spec: ConfigSpec,
  kind: ConfigKind,
  scope = "configuration",
): ConfigReport {
  const e = (env ?? {}) as Record<string, unknown>;
  const problems: ConfigProblem[] = [];

  for (const [name, raw] of Object.entries(normalizeSpec(spec))) {
    const item = raw;
    const value = e[name];
    const hint =
      item.hint ??
      `缺失则 ${item.why}；请配置 ${name}（${KIND_HINT[kind]}）`;

    if (!present(value)) {
      problems.push({
        kind,
        name,
        reason: `未注入或为空 —— ${item.why}`,
        hint,
        fatal: item.required !== false,
      });
      continue;
    }

    if (item.check && !item.check(value)) {
      problems.push({
        kind,
        name,
        reason: `已注入但未通过校验 —— ${item.why}`,
        hint,
        fatal: item.required !== false,
      });
    }
  }

  const fatal = problems.filter((p) => p.fatal);
  return {
    ok: fatal.length === 0,
    problems,
    summary:
      problems.length === 0
        ? `${scope}: 配置完整`
        : `${scope}: ${fatal.length} 项致命 / ${problems.length} 项问题`,
  };
}

/**
 * **fail-closed** 断言：存在致命问题即抛 {@link ConfigError}。
 *
 * 与 `console.warn` 的区别：异常会沿调用栈冒泡，Worker 入口通常会把它转成
 * 5xx 响应并触发平台告警 —— 运维**一定看得到**。
 *
 * @throws {ConfigError} 存在任一致命问题
 */
export function assertConfigured(
  env: unknown,
  spec: ConfigSpec,
  kind: ConfigKind,
  scope = "configuration",
): void {
  const report = inspect(env, spec, kind, scope);
  if (!report.ok) {
    throw new ConfigError(report.problems.filter((p) => p.fatal), scope);
  }
}

/**
 * 一次性检查多组声明并汇总。
 *
 * @returns 报告；`ok: false` 表示存在致命问题
 */
export function preflight(
  env: unknown,
  groups: {
    secrets?: ConfigSpec;
    bindings?: ConfigSpec;
    vars?: ConfigSpec;
    apiKeys?: ConfigSpec;
  },
  scope = "service",
): ConfigReport {
  const problems: ConfigProblem[] = [];
  for (const [kind, spec] of [
    ["secret", groups.secrets],
    ["binding", groups.bindings],
    ["var", groups.vars],
    ["apiKey", groups.apiKeys],
  ] as Array<[ConfigKind, ConfigSpec | undefined]>) {
    if (!spec) continue;
    problems.push(...inspect(env, spec, kind, scope).problems);
  }
  const fatal = problems.filter((p) => p.fatal);
  return {
    ok: fatal.length === 0,
    problems,
    summary:
      problems.length === 0
        ? `${scope}: 配置完整`
        : `${scope}: ${fatal.length} 项致命 / ${problems.length} 项问题（${fatal
            .map((p) => p.name)
            .join(", ")}）`,
  };
}

/** 把预检报告转成可抛出的异常；`ok` 时返回 `null`。 */
export function toConfigError(
  report: ConfigReport,
  scope = "service",
): ConfigError | null {
  if (report.ok) return null;
  return new ConfigError(report.problems.filter((p) => p.fatal), scope);
}

/**
 * 把 {@link ConfigError} 转成 HTTP 503 响应。
 *
 * 状态码选 **503 Service Unavailable** 而非 500：语义是"依赖的配置/依赖方
 * 不可用，稍后重试"，而不是"代码崩了"。
 *
 * 响应体遵循 AGENTS §7.1 的统一契约 `{ ok:false, error, code }`，并在
 * `details` 中给出缺失清单 —— **不含任何密钥值**。
 *
 * @param err 任意异常；非 ConfigError 时按 500 处理
 */
export function configErrorResponse(err: unknown): Response {
  if (err instanceof ConfigError) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "service_not_configured",
        code: "CONFIG_MISSING",
        details: err.problems.map((p) => ({
          kind: p.kind,
          name: p.name,
          reason: p.reason,
          hint: p.hint,
        })),
      }),
      {
        status: 503,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      },
    );
  }
  return new Response(
    JSON.stringify({ ok: false, error: "internal_error", code: "INTERNAL" }),
    { status: 500, headers: { "content-type": "application/json" } },
  );
}

/** 便捷版：`preflight` + 非 ok 时直接返回 503，否则返回 `null`。 */
export function preflightGuard(
  env: unknown,
  groups: Parameters<typeof preflight>[1],
  scope?: string,
): Response | null {
  const report = preflight(env, groups, scope);
  return report.ok ? null : configErrorResponse(toConfigError(report, scope));
}

// 初始化前置需求（Setup Requirements）—— 与本模块的预检共用同一套 ConfigProblem
export * from "./requirements.js";

// 构建期扫描：把"代码读了但没登记"的环境变量暴露出来
export * from "./strip.js";
export * from "./scan.js";
