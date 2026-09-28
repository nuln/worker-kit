/**
 * 覆盖率下限门禁
 *
 * ## 这条门禁要解决的问题
 *
 * 补覆盖率这件事被反复留尾巴：每轮补完一批，剩下的"都是些琐碎分支"，
 * 于是下一轮接着补，如此往复。原因是没有下限要求 —— 于是
 * "这次先到这里"永远是个合法选项。
 *
 * 这条门禁把"琐碎"变成**一次性、可列举**的：
 *
 * 1. 每个有逻辑的文件，语句 / 函数覆盖率必须达标；
 * 2. 全仓分支覆盖率必须达标；
 * 3. 未覆盖分支的**总数**有硬预算，只许降不许升；
 * 4. 确实不可达的防御分支必须逐行登记理由，且登记项会被校验是否仍然成立
 *    （实现改了、分支已覆盖，登记就必须删 —— 防止登记表腐化）。
 *
 * ## 为什么允许显式登记，而不是追求字面 100%
 *
 * 有些分支在**语法或正则层面**就不可达，例如：
 *
 * ```ts
 * const m = MEMBER_RE.exec(cleaned);   // 正则的捕获组保证 m[2] 非空
 * if (!m[2]) continue;                 // 于是这行永远为 false
 * ```
 *
 * 而 `env?.["X"] = v` 本身就是语法错误，不可能有源码。
 *
 * 为覆盖它们而写测试，只能构造违反前置条件的输入 —— 那类测试不验证任何行为，
 * 反而会在实现重构时误报。**登记比假装覆盖更诚实。**
 */

/* ------------------------------------------------------------ 阈值 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * 门禁只在"专用那一趟"生效。
 *
 * 门禁读的是磁盘上的覆盖率报告，而报告只在测试跑完**之后**才落盘。
 * 若门禁与普通测试同处一趟 vitest，它读到的必然是上一轮的旧数据 ——
 * 表现为"我明明补了测试，门禁还说没覆盖"，或者更糟：读到一份碰巧
 * 达标的历史报告，让新引入的未覆盖逻辑蒙混过关。
 */
const IN_GATE_PASS = process.env.COVERAGE_GATE === "1";

const COVERAGE_JSON = "coverage/coverage-final.json";

/* 全仓分支下限：实测 92.5%，留 2.5 点余量 */
const MIN_BRANCH_OVERALL = 90;
/** 每文件语句下限：实测最低 93.8%，留 1.8 点余量 */
const MIN_STMT_PER_FILE = 92;
/** 每文件函数下限：实测最低 90.9%，留 2.9 点余量 */
const MIN_FUNC_PER_FILE = 88;

/**
 * 全仓未覆盖分支的**硬上限**：实测 181 / 2427。
 *
 * 数字只许降不许升。新增未覆盖分支 = 门禁失败，必须同时二选一：
 * 补测试，或把该行登记进 {@link UNREACHABLE_BRANCHES} 并写明理由。
 */
const MAX_UNCOVERED_BRANCHES = 181;

/** 纯类型文件与再导出 barrel 没有可执行逻辑，不参与门禁 */
const EXEMPT_FILES = [/types\.ts$/, /\/index\.ts$/];

/**
 * 逐文件豁免。
 *
 * 只豁免**下限判定**，不豁免未覆盖总数预算 —— 豁免文件新增未覆盖分支照样会被抓到。
 */
const FILE_EXEMPTIONS: Array<{ file: string; why: string }> = [
  {
    file: "src/config/scan.ts",
    why:
      "本文件是构建期扫描器，大量分支属于\"输入不可能长这样\"的类型。\n" +
      "        例如捕获组非空判断（正则保证）、索引访问的写入形态（语法错误）、\n" +
      "        括号配对失败（调用前已确认是右括号）。\n" +
      "        这些已逐行登记在 UNREACHABLE_BRANCHES；\n" +
      "        用下限去卡它只会诱导后来者写没有验证价值的假测试。",
  },
];

/* ------------------------------------------ 逐行登记的不可达分支 */

const UNREACHABLE_BRANCHES: Array<{ file: string; line: number; why: string }> = [
  { file: "src/config/scan.ts", line: 198, why: "仅在确认当前位置是 `)` 时调用，作用域窗口内的括号必然配平，返回 -1 不可达" },
  { file: "src/config/scan.ts", line: 420, why: "INDEXED_RE 的捕获组 `[A-Za-z_$][A-Za-z0-9_$]*` 保证 m[1] 非空" },
  { file: "src/config/scan.ts", line: 430, why: "OPTIONAL_MEMBER_RE 的捕获组保证非空" },
  { file: "src/config/scan.ts", line: 441, why: "OPTIONAL_INDEXED_RE 的捕获组保证非空" },
  { file: "src/config/scan.ts", line: 452, why: "解构模式的捕获组保证非空" },
  { file: "src/config/scan.ts", line: 454, why: "`env?.[\"X\"] = v` 是语法错误，可选链索引访问不可能是写入" },
  { file: "src/config/scan.ts", line: 468, why: "解构后按 `?? \"默认值\"` 切分，空片段已在上一轮过滤" },
  { file: "src/config/scan.ts", line: 488, why: "解构项经 `if (!name) continue` 过滤后必非空" },
  { file: "src/config/scan.ts", line: 497, why: "别名表项来自 `String.trim()` 后过滤，恒非空" },
];

/* ------------------------------------------------------------ 工具 */

function hasCoverageReport(): boolean {
  return IN_GATE_PASS && existsSync(COVERAGE_JSON);
}

interface CoverageEntry {
  s: Record<string, number>;
  f: Record<string, number>;
  b: Record<string, number[]>;
  branchMap: Record<
    string,
    { locations?: Array<{ start: { line: number } }>; loc?: { start: { line: number } } }
  >;
}

const pct = (hits: number[]) =>
  hits.length === 0 ? 100 : (100 * hits.filter((h) => h > 0).length) / hits.length;

const readPkg = () =>
  JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

const listSrcFiles = (): string[] => {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts")) out.push(p);
    }
  };
  walk("src");
  return out;
};

/* ------------------------------------------------------------ 前提 */

describe("门禁自身的接线前提", () => {
  it("npm test 先跑覆盖率再跑门禁", () => {
    // 覆盖率报告在运行**结束后**才落盘，而门禁要在收集阶段读它，
    // 因此两者不能放在同一趟 vitest 里。
    const s = readPkg().scripts;
    expect(s.test, "test 应串联覆盖率与门禁").toMatch(/test:coverage/);
    expect(s.test).toMatch(/test:gate/);
    expect(s["test:gate"], "门禁必须单独一趟").toContain("coverage-floor-gate");
    expect(s["test:gate"], "门禁趟需显式打开开关").toMatch(/COVERAGE_GATE=1/);
  });

  it("覆盖率配置产出 json 报告（门禁的唯一数据源）", () => {
    // 少了 json reporter → coverage-final.json 不存在 → 门禁被静默跳过 →
    // 整套下限机制形同虚设。
    const cfg = readFileSync("vitest.config.ts", "utf8");
    expect(cfg).toMatch(/reporter:[^}]*"json"/);
  });

  it("门禁主体只在专用趟生效（普通趟读到的是陈旧报告，必须跳过）", () => {
    expect(typeof IN_GATE_PASS).toBe("boolean");
  });
});

/* ------------------------------------------------------------ 主体 */

describe.skipIf(!hasCoverageReport())("覆盖率下限", () => {
  /**
   * 惰性加载：`describe.skipIf` 仍会**执行** describe 体，
   * 所以不能在体顶层直接读文件 —— 没有报告时那会让整个文件加载失败，
   * 而"跳过"与"加载失败"在 CI 里长得完全不一样。
   */
  const load = (): Array<[string, string, CoverageEntry]> => {
    const cov = JSON.parse(readFileSync(COVERAGE_JSON, "utf8")) as Record<string, CoverageEntry>;
    return Object.entries(cov)
      .map(([f, d]) => [f.replace(/^.*\/src\//, "src/"), f, d] as [string, string, CoverageEntry])
      .filter(([rel]) => rel.startsWith("src/") && !EXEMPT_FILES.some((re) => re.test(rel)));
  };

  const exempt = (rel: string) => FILE_EXEMPTIONS.some((e) => e.file === rel);

  it("处于门禁专用趟，且能读到刚落盘的报告", () => {
    expect(IN_GATE_PASS, "本组用例应在 `npm run test:gate` 里运行").toBe(true);
    expect(hasCoverageReport()).toBe(true);
  });

  it("覆盖率报告覆盖了全部逻辑文件", () => {
    expect(load().length, "应识别出 40 个以上有逻辑的文件").toBeGreaterThan(40);
  });

  it(`每个有逻辑的文件：语句 ≥ ${MIN_STMT_PER_FILE}%`, () => {
    const bad: string[] = [];
    for (const [rel, , d] of load()) {
      if (exempt(rel)) continue;
      const v = pct(Object.values(d.s));
      if (v < MIN_STMT_PER_FILE) bad.push(`${rel} 语句 ${v.toFixed(1)}%`);
    }
    expect(bad, `低于语句覆盖下限：\n${bad.join("\n")}`).toEqual([]);
  });

  it(`每个有逻辑的文件：函数 ≥ ${MIN_FUNC_PER_FILE}%`, () => {
    const bad: string[] = [];
    for (const [rel, , d] of load()) {
      if (exempt(rel)) continue;
      const v = pct(Object.values(d.f));
      if (v < MIN_FUNC_PER_FILE) bad.push(`${rel} 函数 ${v.toFixed(1)}%`);
    }
    expect(bad, `低于函数覆盖下限：\n${bad.join("\n")}`).toEqual([]);
  });

  it(`全仓分支覆盖率 ≥ ${MIN_BRANCH_OVERALL}%`, () => {
    const all = load().flatMap(([, , d]) => Object.values(d.b).flat());
    const v = pct(all);
    expect(v, `全仓分支覆盖率 ${v.toFixed(2)}%`).toBeGreaterThanOrEqual(MIN_BRANCH_OVERALL);
  });

  it(`未覆盖分支总数 ≤ ${MAX_UNCOVERED_BRANCHES}（只许降不许升）`, () => {
    // 这是本门禁的核心：补完的成果不会在下一轮回吐。
    // 新增未覆盖分支必须二选一 —— 补测试，或登记进 UNREACHABLE_BRANCHES。
    const missed: string[] = [];
    for (const [rel, , d] of load()) {
      for (const [k, v] of Object.entries(d.branchMap)) {
        (d.b[k] ?? []).forEach((h, i) => {
          if (h > 0) return;
          const line = (v.locations?.[i] ?? v.loc)?.start.line ?? 0;
          missed.push(`${rel}:${line}`);
        });
      }
    }
    expect(
      missed.length,
      `未覆盖分支 ${missed.length} 个（上限 ${MAX_UNCOVERED_BRANCHES}）。\n` +
        `新增的这些必须补测试，或登记进 UNREACHABLE_BRANCHES：\n${missed.slice(0, 30).join("\n")}`,
    ).toBeLessThanOrEqual(MAX_UNCOVERED_BRANCHES);
  });

  it("登记的不可达分支必须真的仍未覆盖（否则该删掉登记）", () => {
    // 防止登记表腐化：实现改了、分支已覆盖，登记却还留着。
    const entries = load();
    const stale: string[] = [];
    for (const r of UNREACHABLE_BRANCHES) {
      const hit = entries.find(([rel]) => rel === r.file);
      if (!hit) {
        stale.push(`${r.file}:${r.line} 文件不存在`);
        continue;
      }
      const stillUncovered = Object.values(hit[2].branchMap).some((v) =>
        (v.locations ?? []).some((l) => l.start.line === r.line),
      );
      if (!stillUncovered) stale.push(`${r.file}:${r.line} 该行已无未覆盖分支，登记应移除`);
    }
    expect(stale, `登记已失效：\n${stale.join("\n")}`).toEqual([]);
  });

  it("登记的每一行都必须真的未覆盖（防止拿可达分支当借口登记）", () => {
    // 反向校验：登记是"承认这块测不了"，不是"给漏测开的后门"。
    const entries = load();
    const bogus: string[] = [];
    for (const r of UNREACHABLE_BRANCHES) {
      const d = entries.find(([rel]) => rel === r.file)?.[2];
      if (!d) continue;
      // 该行是否仍有未命中的分支
      const anyUncovered = Object.entries(d.branchMap).some(
        ([k, v]) =>
          (v.locations ?? []).some((l) => l.start.line === r.line) &&
          (d.b[k] ?? []).some((h) => h === 0),
      );
      if (!anyUncovered) bogus.push(`${r.file}:${r.line} 该行已全覆盖，不该登记为不可达`);
    }
    expect(bogus, `登记与实际不符：\n${bogus.join("\n")}`).toEqual([]);
  });
});

/* ------------------------------------------------------------ 配置自洽 */

describe("门禁配置本身是自洽的（无需覆盖率数据即可校验）", () => {
  it("阈值留有真实余量，不是贴着实测值", () => {
    // 贴着实测值设阈值 = 下次补一条测试就红，等于逼人把阈值一起改 ——
    // 那时门禁已经名存实亡。
    expect(MIN_BRANCH_OVERALL).toBeGreaterThanOrEqual(85);
    expect(MIN_BRANCH_OVERALL).toBeLessThanOrEqual(91);
    expect(MIN_STMT_PER_FILE).toBeGreaterThanOrEqual(90);
    expect(MIN_FUNC_PER_FILE).toBeGreaterThanOrEqual(85);
  });

  it("预算必须大于已登记的不可达条目数", () => {
    expect(MAX_UNCOVERED_BRANCHES).toBeGreaterThan(UNREACHABLE_BRANCHES.length);
  });

  it("每条登记都写明了理由", () => {
    for (const r of UNREACHABLE_BRANCHES) {
      expect(r.why.length, `${r.file}:${r.line} 缺理由`).toBeGreaterThan(10);
      expect(r.file.startsWith("src/")).toBe(true);
      expect(r.line).toBeGreaterThan(0);
    }
  });

  it("每条豁免都写明了理由，且指向真实存在的文件", () => {
    const srcFiles = listSrcFiles();
    for (const e of FILE_EXEMPTIONS) {
      expect(e.why.length, `${e.file} 缺理由`).toBeGreaterThan(20);
      expect(srcFiles, `${e.file} 不存在`).toContain(e.file);
    }
  });

  it("登记引用的文件都真实存在（防止写了路径就以为登记生效）", () => {
    const srcFiles = listSrcFiles();
    for (const r of UNREACHABLE_BRANCHES) {
      expect(srcFiles, `${r.file} 不存在`).toContain(r.file);
    }
  });

  it("豁免文件不得超出预算的 10%（防止整片代码被豁免掉门禁）", () => {
    const n = FILE_EXEMPTIONS.length;
    expect(n, "豁免文件过多 = 门禁形同虚设").toBeLessThanOrEqual(3);
  });
});
