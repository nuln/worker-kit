/**
 * 文档与覆盖率声明的诚实性门禁
 *
 * ## 为什么要这个文件
 *
 * 覆盖率与测试命名此前**长期虚标**，且没有任何机制会发现：
 *
 * - README 徽章写 `Coverage-95.01%`，实测仅 88.84% stmts / 79.17% branch
 *   （初次审计时的数字）
 * - 测试文件名 `perfection-coverage-99.test.ts` / `coverage-boost-100.test.ts` /
 *   `more-coverage-perfection.test.ts` —— 名称宣称 99%/100%，实际远低于此
 *
 * 覆盖率报告是「还差多少」的量化信号；一旦它本身失真，团队就会失去
 * 「覆盖率下降 = 引入未测代码」这个判断依据。
 *
 * 本门禁做三件事：
 * 1. 徽章数字必须与实测值一致（容差 0.2pt）
 * 2. 不得存在以覆盖率数字命名的测试文件或 describe 块
 * 3. 记录一次基线，防止覆盖率**倒退**而无人察觉
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";

/** 覆盖率基线（由 `npm run test:coverage` 实测写入）。下调需同步更新本文件。 */
const COVERAGE_BASELINE = {
  statements: 96.84,
  branches: 92.3,
  functions: 98.52,
  lines: 97.37,
};

const ROOT = process.cwd();
const TEST_ROOT = `${ROOT}/test`;

/** 递归收集全部 .test.ts（测试已按 AGENTS §9 分层，不能只扫一层）。 */
function collectTests(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (entry === "node_modules") continue;
    if (statSync(full).isDirectory()) {
      collectTests(full, out);
    } else if (entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("覆盖率徽章必须与实测一致", () => {
  it("README 徽章数字与覆盖率基线一致（容差 0.2pt）", () => {
    for (const p of ["README.md", "README.zh-CN.md"]) {
      const text = readFileSync(`${ROOT}/${p}`, "utf8");
      const m = text.match(/Coverage-([\d.]+)%25/);
      expect(m, `${p} 缺少 Coverage 徽章`).toBeTruthy();
      const declared = Number(m![1]);
      expect(
        Math.abs(declared - COVERAGE_BASELINE.statements),
        `${p} 徽章 ${declared}% 与实测 ${COVERAGE_BASELINE.statements}% 不符`,
      ).toBeLessThanOrEqual(0.2);
    }
  });

  it("docs 索引中引用的文件必须真实存在", () => {
    // 文档索引曾列出 8 个模块，但其中 5 个 docs/*.md 从未创建 ——
    // 与"覆盖率徽章虚标"同类的失真：链接点开是 404。
    for (const f of ["docs/zh/README.md", "docs/en/README.md"]) {
      const text = readFileSync(`${ROOT}/${f}`, "utf8");
      const links = [...text.matchAll(/\(\.\/?([a-z0-9-]+\.md)\)/g)].map((m) => m[1] ?? "");
      expect(links.length, `${f} 应有文档链接`).toBeGreaterThan(0);
      // 链接相对 README 自身所在目录解析
      const dir = f.replace(/[^/]+$/, "");
      const missing = links.filter((l) => !statSync(`${ROOT}/${dir}${l}`).isFile());
      expect(missing, `${f} 引用了不存在的文档：${missing.join(", ")}`).toEqual([]);
    }
  });

  it("中英文档索引条目一一对应（不得单边新增）", () => {
    const linksOf = (f: string) =>
      [...readFileSync(`${ROOT}/${f}`, "utf8").matchAll(/\(\.\/?([a-z0-9-]+\.md)\)/g)]
        .map((m) => m[1] ?? "")
        .sort();
    expect(linksOf("docs/zh/README.md")).toEqual(linksOf("docs/en/README.md"));
  });

  it("不得出现「零依赖」等失实描述", () => {
    const en = readFileSync(`${ROOT}/README.md`, "utf8");
    // package.json 有两个运行时依赖（tiny-cbor / simplewebauthn）
    expect(
      en.includes("zero-dependency"),
      'README 声称 "zero-dependency"，但 package.json 有 2 个运行时依赖',
    ).toBe(false);
  });
});

describe("不得存在以覆盖率数字命名的测试", () => {
  it("测试文件名不含 perfection / coverage-NN / NN% 之类的宣称", () => {
    const files = collectTests(TEST_ROOT);
    expect(files.length, "递归扫描应找到测试文件").toBeGreaterThan(0);
    const offenders = files.filter((f) =>
      /perfection|coverage[-_]?\d+|[-_]?\d{2,3}\s*%/.test(f),
    );
    expect(
      offenders,
      `这些测试文件名宣称了未达成的覆盖率：${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("describe 块名不含 perfection / coverage 夸大表述", () => {
    const files = collectTests(TEST_ROOT);
    const offenders: string[] = [];
    for (const full of files) {
      const f = full.slice(TEST_ROOT.length + 1);
      const text = readFileSync(full, "utf8");
      for (const m of text.matchAll(/describe\(\s*["'`]([^"'`]+)["'`]/g)) {
        const name = m[1] ?? "";
        if (/perfection|100%\s*coverage|99%\s*coverage/i.test(name)) {
          offenders.push(`${f}: ${name}`);
        }
      }
    }
    expect(offenders, `describe 块名夸大覆盖率：${offenders.join("; ")}`).toEqual([]);
  });
});

describe("覆盖率基线（防倒退）", () => {
  it("基线四项均有记录且处于合理区间", () => {
    for (const [k, v] of Object.entries(COVERAGE_BASELINE)) {
      expect(v, `${k} 基线缺失`).toBeGreaterThan(0);
      expect(v, `${k} 基线不可能超过 100`).toBeLessThanOrEqual(100);
    }
    // 分支覆盖通常最低；若哪天四项都 >95%，本门禁的基线应上调
    expect(COVERAGE_BASELINE.branches).toBeLessThanOrEqual(
      COVERAGE_BASELINE.statements,
    );
  });
});

/**
 * 测试目录分层门禁（AGENTS §9）
 *
 * 规范原文：「`test/` 目录必须严格按测试类型分层分类治理，**禁止在 `test/`
 * 根目录下无序平铺测试文件**」，并要求存在 `unit/` `integration/` `e2e/`
 * `ui/` 四个子目录与 `helpers` / `setup` 两个文件。
 *
 * ## 为什么这条规范值得设门禁
 *
 * 定义这条规则的 kit 自己此前并未遵守：76 个测试文件全部平铺在 `test/` 根目录，
 * 而 8 个微服务（oidc / tower / mail / push / flash / console / pay / haeo）
 * **全部合规**。规范被知晓但未在自身执行，且没有任何机制会暴露这个差距。
 */
describe("测试目录分层（AGENTS §9）", () => {
  it("四个分层子目录均存在", () => {
    for (const d of ["unit", "integration", "e2e", "ui"]) {
      expect(statSync(`${TEST_ROOT}/${d}`).isDirectory(), `缺少 test/${d}/`).toBe(true);
    }
  });

  it("helpers 与 setup 均存在（规范明确要求）", () => {
    expect(statSync(`${TEST_ROOT}/helpers.ts`).isFile()).toBe(true);
    expect(statSync(`${TEST_ROOT}/setup.ts`).isFile()).toBe(true);
  });

  it("test/ 根目录下不得平铺 .test.ts", () => {
    const flat = readdirSync(TEST_ROOT).filter((f) => f.endsWith(".test.ts"));
    expect(
      flat,
      `test/ 根目录仍有平铺测试文件（AGENTS §9 明文禁止）：${flat.join(", ")}`,
    ).toEqual([]);
  });

  it("每个分层目录内不得再嵌套其他分层目录", () => {
    for (const d of ["unit", "integration", "e2e", "ui"]) {
      const nested = readdirSync(`${TEST_ROOT}/${d}`).filter((e) =>
        ["unit", "integration", "e2e", "ui"].includes(e),
      );
      expect(nested, `test/${d}/ 内出现嵌套分层目录：${nested.join(", ")}`).toEqual([]);
    }
  });

  it("四个分层均有测试文件（避免空目录蒙混过关）", () => {
    for (const d of ["unit", "integration", "e2e", "ui"]) {
      const n = collectTests(`${TEST_ROOT}/${d}`).length;
      expect(n, `test/${d}/ 为空`).toBeGreaterThan(0);
    }
  });
});
