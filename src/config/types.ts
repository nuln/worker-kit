/**
 * @nuln/worker-kit/config/types
 *
 * 配置检查的公共类型。
 *
 * ## 为什么单独成文件
 *
 * `index.ts` 与 `requirements.ts` 都需要 `ConfigKind` / `ConfigProblem`，
 * 而 `index.ts` 又 `export * from "./requirements.js"`。两者同处一文件时
 * 构成运行时循环依赖（ESM/CJS 都可能因此拿到未初始化的导出）。
 * 类型抽离后 `requirements` 只依赖本文件，环即断开，
 * 而对外导出路径（`@nuln/worker-kit/config`）完全不变。
 */

export type ConfigKind =
  /** wrangler secret（`wrangler secret put` 注入） */
  | "secret"
  /** wrangler vars / 环境变量 */
  | "var"
  /** Workers 绑定（KV / D1 / R2 / DO / 服务） */
  | "binding"
  /** 第三方 API 凭据 */
  | "apiKey";

/** 单条配置问题。 */
export interface ConfigProblem {
  kind: ConfigKind;
  /** 环境变量或绑定名 */
  name: string;
  /** 人类可读的缺失原因（不含任何密钥值） */
  reason: string;
  /** 修复指引 */
  hint: string;
  /** 是否为致命项。非致命项仅记录，不阻断请求。 */
  fatal: boolean;
}
