/**
 * @nuln/worker-kit — 校验类 API 命名规范
 *
 * ## 约定（唯一定义，全库一致）
 *
 * | 前缀 | 失败行为 | 返回值 | 用途 |
 * |---|---|---|---|
 * | `assertXxx()` | **抛错** | 归一化后的值（或 `void`） | 守门：不通过就不该继续 |
 * | `isXxx()` | **永不抛错** | `boolean` | 过滤 / 条件判断 / 表单校验 |
 *
 * 配对的布尔版与抛错版**必须镜像命名**：
 * `assertSsoOrigin` ⇄ `isSsoOriginAllowed`，
 * `assertSafeIdentifier` ⇄ `isSafeIdentifier`。
 *
 * ## 为什么要有这条规范
 *
 * 历史上同一个概念存在三套前缀，且出现过**同名不同签名**的实例：
 * `sso` 的 `assertSsoOrigin(url, csv) => string`（抛错）与
 * `urls` 的 `assertSsoOrigin(origin, allowlist[]) => boolean`（不抛）。
 * 调用方按其中一种签名编写、编译到另一种上，行为完全错位且**编译器不报错**。
 *
 * 混用 `validate*`（有时返回布尔、有时抛错）进一步加剧了这个问题：
 * 调用方无法从名字判断失败时会怎样。
 *
 * 现在这条约定由 {@link checkNamingConvention} 自动校验，新增函数若不符合
 * 会在测试中失败。
 *
 * @packageDocumentation
 */

/** 符合规范的导出名前缀。 */
export const VALIDATION_PREFIXES = ["assert", "is"] as const;

/**
 * 强制要求与 {@link assertSsoOrigin} 镜像命名的布尔版。
 *
 * 历史上这里叫 `isOriginInAllowlist`，与抛错版 `assertSsoOrigin` 不构成镜像，
 * 容易让人误以为是两个不相关的功能。现统一为 `isSsoOriginAllowed`。
 */
export const SSO_ORIGIN_BOOL_NAME = "isSsoOriginAllowed";

/**
 * 判断一个函数名是否符合命名规范。
 *
 * @param name 导出或声明的函数名
 * @returns 符合规范返回 `true`
 */
export function isConventionalValidationName(name: string): boolean {
  if (!/^(assert|is|validate|check|require)[A-Z]/.test(name)) return true; // 非校验类函数
  if (name.startsWith("validate")) return false;
  if (name.startsWith("check")) return false;
  if (name.startsWith("require")) return false;
  return true;
}
