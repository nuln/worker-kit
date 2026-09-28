/**
 * Example 22: 环境变量访问扫描（构建期）
 *
 * 演示**为什么 `/setup` 的前置检查光靠人工声明是不够的**，以及配套的构建期扫描。
 *
 * ## 问题
 *
 * `/setup` 的前置检查读的是服务显式声明的 `requirements`。
 * 只要开发者新读了一个 `env.FOO` 却忘了登记，这个变量就完全隐身：
 *
 * - `/setup` 不会提示它
 * - CI 不会报错
 * - 运行时炸掉时，错误信息里只有 `undefined is not a function`
 *
 * 而 Worker **运行时无法枚举"代码将要读哪些变量"** —— 平台只给一个 `env` 对象。
 * 所以"把**你没发现**的那部分也暴露出来"只能在构建期做：静态扫描源码。
 *
 * ## 三层防线
 *
 * ```text
 * ① 构建期  scanEnvAccess()   静态扫描源码，找出「读了但没登记」
 * ② 声明层  requirements      纯数据声明，前置检查与 /setup 清单共用
 * ③ 运行期  assertConfigured  缺失即抛错 / 503，绝不静默降级
 * ```
 *
 * 三层都堵不住才叫真的漏了 —— 单靠任何一层都有盲区。
 */

import {
  defineRequirements,
  REQUIREMENTS,
  evaluateRequirements,
  type Requirements,
} from "@nuln/worker-kit/config";
import {
  scanEnvAccess,
  bareAccesses,
  reportUndeclaredEnv,
  configuredKeySet,
  reportUnusedConfig,
  type EnvAccess,
} from "@nuln/worker-kit/config";

/* ------------------------------------------------------ ② 声明层（已有） */

/**
 * 本服务声明的初始化前置需求。
 *
 * 注意：这是**人工**清单，必然会有遗漏 —— 遗漏正是 ① 要补的。
 */
export const requirements: Requirements = defineRequirements(
  REQUIREMENTS.passkey,
  REQUIREMENTS.session,
  REQUIREMENTS.ratelimit,
  REQUIREMENTS.database,
  { name: "GITHUB_TOKEN", kind: "apiKey", why: "GitHub 部署凭据" },
  { name: "GITHUB_REPO", kind: "apiKey", why: "目标仓库（owner/name）" },
  { name: "MAX_UPLOAD_BYTES", kind: "var", why: "单文件上传上限", required: false },
);

/* ------------------------------------------------------ ① 构建期扫描 */

/** 读一个文件（示例里用字符串代替 fs） */
function scanFile(source: string, fileLabel: string): EnvAccess[] {
  return scanEnvAccess(source, fileLabel);
}

/**
 * 把源码里「代码读了、但 `requirements` 与 wrangler 都没登记」的变量找出来。
 *
 * @param sources 形如 `[{ file: "src/index.ts", code: "…" }]`
 * @param configured 已知配置键（wrangler.jsonc 的 vars / bindings + 已注入的 secret 名）
 */
export function findUndeclared(
  sources: Array<{ file: string; code: string }>,
  configured: { vars?: string[]; bindings?: string[]; secrets?: string[] },
) {
  const accesses = sources.flatMap((s) => scanFile(s.code, s.file));

  // 人工登记的名字也算"已知" —— 否则会把 requirements 里已声明的又报一遍
  const declared = new Set(requirements.map((r) => r.name));
  const merged = new Set([...configuredKeySet(configured), ...declared]);

  return {
    /** 全部识别到的变量及分类 */
    accesses,
    /** 候选必需项（`bare`）：无兜底、无守卫 */
    candidates: bareAccesses(accesses),
    /** 其中既没登记、wrangler 里也没有的 —— 就是"你漏掉的那部分" */
    undeclared: reportUndeclaredEnv(accesses, {
      vars: [...merged],
      bindings: configured.bindings,
      secrets: configured.secrets,
    }),
    /** 登记了却从未被读取的 —— 多半是重构残留 */
    unused: reportUnusedConfig(accesses, configured),
  };
}

/* ------------------------------------------------------ 使用示例 */

const SOURCES = [
  {
    file: "src/routes/api-deploy.ts",
    code: `
      export async function deploy(env: Env, req: Request) {
        // 有兜底 → 扫描器判为 defaulted，不要求配置
        const branch = env.GITHUB_BRANCH || "main";

        // 已登记 → 不会报
        const token = env.GITHUB_TOKEN!;

        // 忘了登记、也没有兜底 → 这就是"你没发现的那一个"
        const repo = env.NOT_REGISTERED_YET;

        return doDeploy(token, repo, branch);
      }
    `,
  },
];

/** 完整跑一遍并输出人类可读报告 */
export function audit(): string {
  const r = findUndeclared(SOURCES, {
    vars: ["ENVIRONMENT", "GITHUB_BRANCH"],
    bindings: ["DB", "RATE_LIMITER_DO"],
    secrets: ["COOKIE_SECRET", "AUTH_SESSION_DO_SECRET"],
  });

  const lines: string[] = [];
  lines.push(`识别 ${r.accesses.length} 个环境变量：`);
  for (const a of r.accesses) {
    lines.push(`  ${a.name.padEnd(24)} ${a.kind}${a.bareLocations?.length ? `  ← ${a.bareLocations.join(", ")}` : ""}`);
  }
  lines.push("");
  if (r.undeclared.length === 0) {
    lines.push("✔ 没有「代码读了但没登记」的环境变量。");
  } else {
    lines.push(`✘ ${r.undeclared.length} 个变量被裸访问却没登记，需逐个给结论：`);
    for (const u of r.undeclared) {
      lines.push(`  ${u.name}`);
      for (const l of u.locations) lines.push(`      ${l}`);
    }
  }
  return lines.join("\n");
}

/* ------------------------------------------------------ ③ 运行期兜底 */

/**
 * 运行期最后一道：即使构建期漏了，初始化接口也不会让人带着残缺配置走下去。
 *
 * 与页面**共用同一套判定**（`evaluateRequirements`），因此
 * 「页面上显示缺什么」与「接口拦什么」永远一致。
 */
export function setupApiGuard(env: unknown): Response | null {
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
    { status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
}
