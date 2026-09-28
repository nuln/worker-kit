/**
 * @nuln/worker-kit/db — SQL 标识符安全校验
 *
 * ## 为什么需要共享
 *
 * 表名与列名无法用 `?` 占位符绑定，必须以字符串形式拼进 SQL。只要它们来自
 * 不可信输入（备份包 JSON、D1 增量同步载荷），就必须先经白名单校验。
 *
 * 历史不一致：`sync/receiver.ts` 有 `assertSafeIdentifier` 并调用 4 次，
 * 而 `backup/engine.ts` 的恢复路径**完全没有校验**，同一仓库内形成鲜明对比。
 * 本模块把校验收敛为单一实现，两侧共用，避免再次分叉。
 *
 * ## 威胁模型
 *
 * D1 / SQLite 的"单语句限制"能挡住堆叠查询，但**挡不住单语句内的破坏性谓词**：
 * 表名 `users" WHERE 1=1 --` 可让 `DELETE FROM "users" WHERE 1=1 --"`
 * 退化为无条件清空。因此白名单必须是严格字符集，不能只做引号转义。
 */

/** 合法 SQL 标识符白名单：仅 ASCII 字母、数字、下划线，且不以数字开头。 */
const IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 标识符长度上限（与 SQLite 实际限制一致，留足余量）。 */
export const MAX_IDENTIFIER_LENGTH = 64;

/**
 * 校验 SQL 标识符（表名、列名）是否安全可拼接。
 *
 * 判定条件全部满足才通过：
 * - 非空字符串
 * - 长度不超过 {@link MAX_IDENTIFIER_LENGTH}
 * - 首个字符为字母或下划线（不以数字开头）
 * - 后续字符仅 ASCII 字母 / 数字 / 下划线
 *
 * 以上条件排除引号、空格、分号、注释符（`--` `/*`）、括号与反引号，
 * 因此标识符无法跳出所引用的标识符上下文。
 *
 * @param name 待校验的标识符
 * @param kind 标识符种类，仅用于错误信息
 * @throws {Error} 校验失败时抛出，**绝不**返回布尔值让调用方忘记检查
 */
export function assertSafeIdentifier(name: unknown, kind: "table" | "column" = "table"): asserts name is string {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`[SQL-ID] 非法 ${kind} 名称: ${JSON.stringify(name)}（期望非空字符串）`);
  }
  if (name.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(
      `[SQL-ID] ${kind} 名称过长: ${name.length} > ${MAX_IDENTIFIER_LENGTH}`,
    );
  }
  if (!IDENTIFIER_REGEX.test(name)) {
    throw new Error(
      `[SQL-ID] 非法 ${kind} 名称: ${JSON.stringify(name)}` +
        `（仅允许字母/数字/下划线，且不以数字开头）`,
    );
  }
}

/**
 * {@link assertSafeIdentifier} 的布尔版本，供不便抛异常的调用点使用。
 *
 * @returns 标识符是否安全可拼接
 */
export function isSafeIdentifier(name: unknown): boolean {
  try {
    assertSafeIdentifier(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * 批量校验并返回规范化后的标识符数组。
 *
 * @throws {Error} 任一标识符非法即抛出，调用点不应跳过
 */
export function assertSafeIdentifiers(
  names: readonly unknown[],
  kind: "table" | "column" = "column",
): string[] {
  const out: string[] = [];
  for (const n of names) {
    assertSafeIdentifier(n, kind);
    out.push(n);
  }
  return out;
}
