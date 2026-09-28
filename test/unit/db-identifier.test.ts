/**
 * SQL 标识符注入防御测试。
 *
 * 覆盖两条此前不一致的路径：
 * - `sync/receiver.ts`（D1 增量同步接收端）
 * - `backup/engine.ts`（备份包恢复）
 *
 * 二者的表名/列名都来自不可信 JSON 且必须字符串拼接进 SQL。历史实现只有
 * 前者有校验，恢复路径完全没有 —— 构造一个表名即可让
 * `DELETE FROM "<表名>"` 退化为无条件清空。
 *
 * D1/SQLite 的"单语句限制"挡不住单语句内的破坏性谓词，因此必须靠白名单。
 */

import { describe, it, expect } from "vitest";
import {
  assertSafeIdentifier,
  assertSafeIdentifiers,
  isSafeIdentifier,
  MAX_IDENTIFIER_LENGTH,
} from "../../src/db/identifier.js";

describe("assertSafeIdentifier：合法标识符放行", () => {
  it.each(["users", "_tbl", "t1", "Users_2", "a", "_", "A1_b2"])("%s", (n) => {
    expect(() => assertSafeIdentifier(n, "table")).not.toThrow();
  });

  it("恰好等于长度上限的标识符放行", () => {
    const n = "a".repeat(MAX_IDENTIFIER_LENGTH);
    expect(() => assertSafeIdentifier(n)).not.toThrow();
  });
});

describe("assertSafeIdentifier：注入载荷一律拒绝", () => {
  it.each([
    ['users" WHERE 1=1 --', "引号闭合 + 破坏性谓词"],
    ["users; DROP TABLE x", "语句分隔"],
    ["users--", "行注释"],
    ["users/*c*/", "块注释"],
    ["us ers", "空格"],
    ["users)", "括号"],
    ["users`", "反引号"],
    ["1users", "数字开头"],
    ["用户表", "非 ASCII"],
    ["users\nDROP", "换行"],
  ])("%s (%s)", (n) => {
    expect(() => assertSafeIdentifier(n, "table")).toThrow(/\[SQL-ID\]/);
  });

  it("空值与非字符串拒绝", () => {
    expect(() => assertSafeIdentifier("")).toThrow();
    expect(() => assertSafeIdentifier(null)).toThrow();
    expect(() => assertSafeIdentifier(undefined)).toThrow();
    expect(() => assertSafeIdentifier(42)).toThrow();
    expect(() => assertSafeIdentifier({})).toThrow();
  });

  it("超长标识符拒绝", () => {
    expect(() => assertSafeIdentifier("a".repeat(MAX_IDENTIFIER_LENGTH + 1))).toThrow(/过长/);
  });

  it("错误信息回显被拒标识符，但经 JSON 转义（防日志注入）", () => {
    // 标识符原样写进错误信息会有日志注入风险（攻击者可塞入换行伪造日志行），
    // 因此用 JSON.stringify 转义后再回显：引号变 \"，但内容仍可辨认。
    expect(() => assertSafeIdentifier('x" OR 1=1 --')).toThrow(
      /x\\" OR 1=1 --/,
    );
  });
});

describe("isSafeIdentifier / assertSafeIdentifiers", () => {
  it("布尔版与抛错版结论一致", () => {
    expect(isSafeIdentifier("users")).toBe(true);
    expect(isSafeIdentifier('users" --')).toBe(false);
  });

  it("批量校验：任一非法即抛出，且不做部分放行", () => {
    expect(assertSafeIdentifiers(["a", "b", "c"])).toEqual(["a", "b", "c"]);
    expect(() => assertSafeIdentifiers(["a", 'b" --', "c"])).toThrow(/\[SQL-ID\]/);
  });
});
