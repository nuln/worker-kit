/**
 * @nuln/worker-kit/config — 初始化前置需求（Setup Requirements）
 *
 * ## 要解决的问题
 *
 * 首次访问 `/setup` 时，如果服务依赖的环境变量还没注入，页面过去仍然正常
 * 渲染出初始化表单 —— 用户填完邮箱、绑完 Passkey，才在后续某个请求上炸掉，
 * 或者更糟：**"假成功"**（邮件只打到控制台、限流根本没生效）。
 *
 * 现在 `/setup` 会先评估依赖，**缺什么就先显示什么**，不进入初始化流程。
 *
 * ## 可扩展性（关键设计约束）
 *
 * 需求是**纯数据**（`SetupRequirement[]`），不是一个需要 switch/if 的枚举。
 * 因此：
 *
 * - 新增一个环境变量 = 往数组里加**一行**，不修改任何渲染或校验代码
 * - kit 内置按能力分组的预设（见 {@link REQUIREMENTS}），服务按需组合
 * - 判定与渲染都是**遍历数据**，因此天然对新增项免疫
 *
 * ```ts
 * // ① 组合：内置预设 + 本服务特有
 * export const requirements = defineRequirements(
 *   REQUIREMENTS.passkey,
 *   REQUIREMENTS.session,
 *   { name: "ADMIN_EMAIL", kind: "var", why: "初始管理员邮箱" },
 * );
 *
 * // ② 以后加变量：只加一行，页面与 API 拦截自动生效
 * export const requirements = defineRequirements(
 *   REQUIREMENTS.passkey,
 *   { name: "ADMIN_EMAIL",   kind: "var",    why: "初始管理员邮箱" },
 *   { name: "SMTP_HOST",     kind: "var",    why: "自建邮件服务器" },
 * );
 * ```
 *
 * @packageDocumentation
 */

import type { ConfigKind, ConfigProblem } from "./types.js";

/** 单项初始化前置需求。**纯数据**，新增项不需要改任何代码。 */
export interface SetupRequirement {
  /** 环境变量名或绑定名 */
  name: string;
  /** 类别，决定提示措辞与修复指引的默认值 */
  kind: ConfigKind;
  /** 为什么需要它 —— 会直接显示在页面上 */
  why: string;
  /** 自定义修复指引；缺省按 kind 生成 */
  hint?: string;
  /** 是否阻断初始化（默认 true）。false 表示"建议配置"，仅提示不阻断 */
  required?: boolean;
  /** 自定义有效性检查：返回 false 视为未正确配置 */
  check?: (value: unknown) => boolean;
}

/** 需求集合。 */
export type Requirements = readonly SetupRequirement[];

/** 判断一个值是否为合法的单项 {@link SetupRequirement}。 */
function isSingleRequirement(v: unknown): v is SetupRequirement {
  return !!v && typeof v === "object" && typeof (v as SetupRequirement).name === "string";
}

/**
 * 组合需求（纯函数，便于 tree-shake 与类型推导）。
 *
 * ## 两种入参形态
 *
 * ```ts
 * defineRequirements(REQUIREMENTS.passkey);                       // 数组
 * defineRequirements({ name: "ADMIN_EMAIL", kind: "var", why: "…" });  // 单项
 * ```
 *
 * **形态必须无歧义。** 曾有一个危险陷阱：传 `{ ADMIN_EMAIL: { kind, why } }`
 * （看起来像"一个需求项的集合"）时，函数会把整个对象当成**一项**
 * `name = "ADMIN_EMAIL"` 的需求，而它的 `kind` / `why` 全是 undefined ——
 * 静默产出错误结果。现对此形态显式抛错。
 *
 * @throws {TypeError} 传入既非数组、也不含 `name` 字符串的对象
 */
export function defineRequirements(
  ...groups: Array<Requirements | SetupRequirement>
): Requirements {
  const seen = new Set<string>();
  const out: SetupRequirement[] = [];

  for (const g of groups) {
    if (Array.isArray(g)) {
      for (const r of g as SetupRequirement[]) push(r);
    } else if (isSingleRequirement(g)) {
      push(g);
    } else {
      throw new TypeError(
        "defineRequirements: 每个入参必须是 Requirements 数组或含 name 的单项。" +
          `收到的是对象（键：${Object.keys((g as object) ?? {}).join(", ") || "无"}）。` +
          `若想表达"一个需求项的集合"，请写成数组：defineRequirements([{ name: "X", kind: "var", why: "…" }])`,
      );
    }
  }

  function push(r: SetupRequirement): void {
    if (!r || typeof r.name !== "string" || r.name.length === 0) return;
    if (seen.has(r.name)) return;
    if (!r.kind) {
      throw new TypeError(
        `defineRequirements: 需求项 "${r.name}" 缺少 kind（secret | binding | var | apiKey）。`,
      );
    }
    if (!r.why) {
      throw new TypeError(
        `defineRequirements: 需求项 "${r.name}" 缺少 why —— 它会直接显示在初始化页面上。`,
      );
    }
    seen.add(r.name);
    out.push({ required: true, ...r });
  }

  return out;
}

/**
 * kit 内置的按能力分组需求预设。
 *
 * 服务只需组合自己用到的分组，无需逐项列举。
 */
export const REQUIREMENTS = {
  /** WebAuthn Passkey：RP ID 与 Origin 是反钓鱼锚点，缺失即 fail-closed */
  passkey: defineRequirements(
    { name: "RP_ID", kind: "var", why: "WebAuthn Relying Party ID（如 auth.nuln.net）—— 缺失将导致验签拒绝" },
    { name: "ORIGIN", kind: "var", why: "WebAuthn Origin 白名单 —— 缺失等于零校验，已 fail-closed" },
    // 可选：追加的额外可信 Origin。扫描器（scripts/check-required-env.mjs）会把它
    // 判为裸访问（`parseOriginAllowlist(env.ALLOWED_ORIGINS)` 是跨函数的默认值，
    // 静态分析看不到），因此显式登记为建议项 —— 既消掉误报，也让使用者知道它存在。
    { name: "ALLOWED_ORIGINS", kind: "var", why: "额外可信 Origin 白名单（逗号分隔），用于多域名部署", required: false },
  ),

  /** 会话：Cookie 签名密钥 + 会话 DO 入口鉴权 */
  session: defineRequirements(
    { name: "COOKIE_SECRET", kind: "secret", why: "会话 Cookie 的 HMAC 签名密钥" },
    { name: "AUTH_SESSION_DO_SECRET", kind: "secret", why: "会话 Durable Object 的 HTTP 入口鉴权 —— 缺失时该入口已 fail-closed（全部 503）" },
  ),

  /** 限流：未绑定即 fail-closed */
  ratelimit: defineRequirements(
    { name: "RATE_LIMITER_DO", kind: "binding", why: "限流 Durable Object 绑定 —— 缺失时限流 fail-closed（返回 503）" },
  ),

  /** 主数据库 */
  database: defineRequirements(
    { name: "DB", kind: "binding", why: "D1 数据库绑定" },
  ),

  /** 邮件投递：缺失会导致密码重置/邮箱验证"假成功" */
  mail: defineRequirements(
    { name: "RESEND_API_KEY", kind: "apiKey", why: "邮件投递凭据 —— 缺失时密码重置与邮箱验证会「假成功」" },
  ),

  /** 备份到 S3 */
  backup: defineRequirements(
    { name: "S3_ACCESS_KEY_ID", kind: "apiKey", why: "S3 备份的 Access Key" },
    { name: "S3_SECRET_ACCESS_KEY", kind: "apiKey", why: "S3 备份的 Secret Key" },
    { name: "S3_BUCKET", kind: "var", why: "S3 备份的 Bucket 名称" },
  ),

  /** 跨节点增量同步 */
  sync: defineRequirements(
    { name: "BACKUP_SYNC_SECRET", kind: "secret", why: "跨节点增量同步的共享密钥" },
  ),

  /** 作为 OIDC IdP 提供单点登录 */
  oidc: defineRequirements(
    { name: "COOKIE_SECRET", kind: "secret", why: "会话 Cookie 的 HMAC 签名密钥" },
    { name: "RP_ID", kind: "var", why: "WebAuthn Relying Party ID" },
    { name: "ORIGIN", kind: "var", why: "WebAuthn Origin 白名单" },
    { name: "ALLOWED_ORIGINS", kind: "var", why: "额外可信 Origin 白名单（逗号分隔）", required: false },
  ),
} as const;

/**
 * 评估环境是否满足全部初始化前置需求。
 *
 * 纯遍历 —— 新增需求项无需修改本函数。
 *
 * @param env Worker 环境对象
 * @param requirements 需求集合
 * @returns 缺失/不合格项；`blocking` 为空数组表示可以进入初始化
 */
export function evaluateRequirements(
  env: unknown,
  requirements: Requirements,
): { ok: boolean; blocking: ConfigProblem[]; advisory: ConfigProblem[]; all: ConfigProblem[] } {
  const e = (env ?? {}) as Record<string, unknown>;
  const all: ConfigProblem[] = [];

  for (const r of requirements) {
    const value = e[r.name];
    const hint = r.hint ?? defaultHint(r.kind, r.name);
    let problem: ConfigProblem | null = null;

    const missing =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim().length === 0);

    if (missing) {
      problem = {
        kind: r.kind,
        name: r.name,
        reason: `未配置 —— ${r.why}`,
        hint,
        fatal: r.required !== false,
      };
    } else if (r.check && !r.check(value)) {
      problem = {
        kind: r.kind,
        name: r.name,
        reason: `已配置但未通过校验 —— ${r.why}`,
        hint,
        fatal: r.required !== false,
      };
    }

    if (problem) all.push(problem);
  }

  const blocking = all.filter((p) => p.fatal);
  return { ok: blocking.length === 0, blocking, advisory: all.filter((p) => !p.fatal), all };
}

function defaultHint(kind: ConfigKind, name: string): string {
  switch (kind) {
    case "secret":
      return `wrangler secret put ${name}`;
    case "binding":
      return `在 wrangler.jsonc 的对应节点声明 ${name} 绑定`;
    case "apiKey":
      return `在 .dev.vars.prod 中配置 ${name}，并执行 npm run secrets:prod:<service>`;
    default:
      return `在 wrangler.jsonc 的 vars 或 .dev.vars 中配置 ${name}`;
  }
}

/**
 * 评估并包装为 {@link import("./index.js").ConfigReport} 形态（供 API 层返回 503）。
 *
 * ## 为什么不再复用 `inspect()`
 *
 * 早期实现是 `inspect(env, spec, "var")` —— 但 `inspect` 的 `kind` 是**整份报告共享**的
 * 单值，会被原样盖进每一条 `ConfigProblem.kind`，并决定缺省 hint 里的修复指引。
 * 于是 `inspectRequirements` 会把
 *
 * - `COOKIE_SECRET`（secret）报成 `kind: "var"`，hint 变成"在 wrangler.jsonc 的 vars
 *   或 .dev.vars 中配置" —— 而它本该用 `wrangler secret put`；
 * - `DB`（binding）报成环境变量；
 * - `RESEND_API_KEY`（apiKey）报成环境变量。
 *
 * 页面走的是 {@link evaluateRequirements}（kind 与 hint 都正确），
 * **同一份 requirements，页面说 A、API 说 B** —— 直接违反
 * 「页面显示什么，API 就拦什么」这条不变量，而且错误信息会把人引向错误的修复动作。
 *
 * 现改为直接基于 `evaluateRequirements` 组装：两者共用同一份判定与同一个
 * `defaultHint`，一致性由**结构**保证，而不是靠两处代码恰好写对。
 */
export function inspectRequirements(env: unknown, requirements: Requirements) {
  const r = evaluateRequirements(env, requirements);
  const problems = r.all;
  return {
    ok: r.ok,
    problems,
    summary:
      problems.length === 0
        ? "configuration: 配置完整"
        : `configuration: ${r.blocking.length} 项致命 / ${problems.length} 项问题`,
  };
}
