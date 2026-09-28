/**
 * @nuln/worker-kit
 *
 * 统一 Nuln Cloudflare Workers 核心开发套件 —— 根入口。
 *
 * ## 两种导入方式
 *
 * 本入口同时提供**平铺具名导出**与**命名空间导出**，两种都受支持：
 *
 * ```ts
 * // 1. 平铺（推荐，文档与示例统一使用此风格）
 * import { authPageResponse, createS3Client, hashPassword } from "@nuln/worker-kit";
 *
 * // 2. 命名空间（需要消歧时使用）
 * import { sso, ui, crypto } from "@nuln/worker-kit";
 *
 * // 3. 子路径（只引入单个模块，减小打包体积）
 * import { authPageResponse } from "@nuln/worker-kit/ui";
 * ```
 *
 * ## 为什么要同时提供平铺导出
 *
 * 历史实现只有 `export * as ns`，导致 README / docs / examples 中全部 32 处
 * `from "@nuln/worker-kit"` 的平铺导入**无法编译**（TS2305），而 AGENTS §1.2
 * 自身规定的用法也是平铺的。现已补齐具名再导出，使文档、示例与规范一致。
 *
 * 子路径入口（`@nuln/worker-kit/ui` 等）保持不变，二者指向同一份实现。
 */

// ── 平铺具名再导出：使 `import { X } from "@nuln/worker-kit"` 可用 ──
export * from "./auth/index.js";
export * from "./backup/index.js";
// basepath 是纯再导出壳（其符号的权威实现位于 urls / ui），平铺导出会在
// barrel 内产生重复成员，因此只提供命名空间形式：
//   import { basepath } from "@nuln/worker-kit"
//   或直接用权威模块：import { isSafeNextUrl } from "@nuln/worker-kit/urls"
export * from "./config/index.js";
export * from "./conventions.js";
export * from "./crypto/index.js";
export * from "./db/index.js";
export * from "./dns/index.js";
export * from "./email/index.js";
export * from "./flags/index.js";
export * from "./http/index.js";
export * from "./middleware/index.js";
export * from "./notify/index.js";
export * from "./observability/index.js";
export * from "./pwa/index.js";
export * from "./ratelimit/index.js";
export * from "./rbac/index.js";
export * from "./s3/index.js";
export * from "./session/index.js";
export * from "./sso/index.js";
export * from "./sync/index.js";
export * from "./ui/index.js";
export * from "./urls/index.js";
export * from "./webauthn/index.js";

// ── 命名空间导出：需要消歧或按模块组织时使用 ──
export * as sso from "./sso/index.js";
export * as ui from "./ui/index.js";
export * as config from "./config/index.js";
export * as conventions from "./conventions.js";
export * as crypto from "./crypto/index.js";
export * as session from "./session/index.js";
export * as http from "./http/index.js";
export * as sync from "./sync/index.js";
export * as urls from "./urls/index.js";
export * as flags from "./flags/index.js";
export * as rbac from "./rbac/index.js";
export * as ratelimit from "./ratelimit/index.js";
export * as email from "./email/index.js";
export * as webauthn from "./webauthn/index.js";
export * as auth from "./auth/index.js";
export * as dns from "./dns/index.js";
export * as observability from "./observability/index.js";
export * as middleware from "./middleware/index.js";
export * as pwa from "./pwa/index.js";
export * as db from "./db/index.js";
export * as s3 from "./s3/index.js";
export * as backup from "./backup/index.js";
export * as basepath from "./basepath/index.js";
export * as notify from "./notify/index.js";
