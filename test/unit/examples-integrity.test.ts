/**
 * 示例代码门禁
 *
 * ## 为什么需要这个文件
 *
 * `examples/` 曾长期不在 `tsconfig.json` 的 `include` 内，因此
 * `npm run typecheck`（其文档承诺「检查全库与示例代码 100% 静态强类型规范」）
 * **从未覆盖到示例**。结果是一批示例引用了**从未存在过**的 API：
 *
 * - `03-auth-example.ts`：`handleSetupOptions` / `handleSetupVerify` /
 *   `handleLoginOptions` / `handleLoginVerify` 四个不存在的函数
 * - `07-db-example.ts`：`baseDelayMs`（真实字段是 `initialBackoffMs`）
 * - `09-email-example.ts`：`normalizeEmailList`（真实是 `toRecipients`），
 *   且混用了 notify 通道与 email provider 两套 API
 * - `13-rbac-example.ts`：`hasPermission` / `canAccessRole` / `ROLES` /
 *   `Permission` 全部不存在（真实是 `hasRole` / `hasScope` / `ROLE_HIERARCHY` / `Role`）
 *
 * 这类文档_rot 只有在示例能被类型检查时才暴露。现已把 `examples/` 纳入
 * tsconfig；本文件再从运行时侧兜一层：断言每个示例文件引用的符号确实存在。
 */

import { describe, it, expect } from "vitest";
import * as kit from "../../src/index.js";

describe("示例代码引用的符号必须真实存在", () => {
  it.each([
    ["03-auth-example", ["authPageResponse", "PasskeyService", "formatSessionCookie"]],
    ["07-db-example", ["withDbRetry"]],
    ["09-email-example", ["createEmailProvider", "toRecipients"]],
    ["13-rbac-example", ["hasRole", "hasScope", "ROLE_HIERARCHY"]],
  ] as Array<[string, string[]]>)("%s", (_label, symbols) => {
    const exported = kit as unknown as Record<string, unknown>;
    for (const sym of symbols) {
      expect(
        sym in exported,
        `示例引用了不存在的导出 "${sym}"。` +
          `examples/ 已纳入 tsconfig，这类错误应在此被拦截。`,
      ).toBe(true);
    }
  });

  it("历史上被示例引用、但从未存在的符号确实不存在（防止又写回去）", () => {
    const exported = kit as unknown as Record<string, unknown>;
    for (const ghost of [
      "handleSetupOptions",
      "handleSetupVerify",
      "handleLoginOptions",
      "handleLoginVerify",
      "normalizeEmailList",
      "hasPermission",
      "canAccessRole",
      "ROLES",
    ]) {
      expect(exported[ghost], `不应存在虚构符号 ${ghost}`).toBeUndefined();
    }
  });
});
