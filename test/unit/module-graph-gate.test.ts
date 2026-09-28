/**
 * 模块图门禁：无循环依赖 + sideEffects 声明（KIT-OPT-03）
 *
 * ## 为什么循环依赖是硬门禁
 *
 * 1. **运行时不确定**：ESM / CJS 下，循环引用时模块可能拿到**未初始化**的
 *    导出（TDZ）。症状是"某些代码路径下 `X is not defined`"，本地跑不出来。
 * 2. **Tree-shaking 失效**：打包器必须保守处理顺序不确定的模块，
 *    整个环上的代码都无法被摇掉。
 * 3. **隐性体积膨胀**：`basepath`（一个纯路径工具）曾经 re-export
 *    `ui/auth-pages` 的 `isLocalhost`，而 auth-pages → http → basepath，
 *    于是**只用 basepath 的 Worker 也会被打进整个 UI 层**。
 *
 * ## 为什么需要 sideEffects: false
 *
 * 只有显式声明后，打包器才敢摇掉"看起来没被引用"的模块。
 * 本仓库的模块都是纯声明（类型 + 函数），没有任何模块加载即执行的副作用
 * —— 门禁会验证这一点，而不是假设它成立。
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, normalize } from "node:path";

/* ------------------------------------------------------------ 图构建 */

function listTsFiles(dir = "src"): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...listTsFiles(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out.sort();
}

/** 解析相对 import / re-export 的目标文件 */
function resolveLocal(from: string, spec: string): string | null {
  const t = normalize(join(dirname(from), spec));
  const cand = t.endsWith(".js") ? t.slice(0, -3) + ".ts" : t + ".ts";
  try {
    statSync(cand);
    return cand;
  } catch {
    try {
      statSync(t);
      return t;
    } catch {
      return null;
    }
  }
}

interface Graph {
  files: string[];
  edges: Map<string, string[]>;
  /** 跨目录依赖（用于 OPT-03 的"轻量模块不得拉进重模块"） */
  crossLayer: Array<{ from: string; to: string }>;
}

function buildGraph(): Graph {
  const files = listTsFiles();
  const edges = new Map<string, string[]>();
  const crossLayer: Array<{ from: string; to: string }> = [];
  // 同时匹配 `import ... from "./x"` 与 `export ... from "./x"`，
  // 两者都会形成运行时边 —— 只查 import 会漏掉 re-export 造成的环
  // （basepath 的环正是通过 re-export 形成的）
  const re = /^\s*(?:import|export)\s+(?:type\s+)?[\s\S]*?from\s+"(\.[^"]+)"/gm;

  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const targets = new Set<string>();
    for (const m of src.matchAll(re)) {
      const t = resolveLocal(f, m[1]!);
      if (t) targets.add(t);
    }
    edges.set(f, [...targets].sort());
    const fromDir = dirname(f);
    for (const t of targets) {
      if (dirname(t) !== fromDir) crossLayer.push({ from: f, to: t });
    }
  }
  return { files, edges, crossLayer };
}

/** 用 DFS 找所有回边对应的环 */
function findCycles(g: Graph): string[][] {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const dfs = (u: string): void => {
    color.set(u, GRAY);
    stack.push(u);
    for (const v of g.edges.get(u) ?? []) {
      const c = color.get(v) ?? WHITE;
      if (c === GRAY) cycles.push([...stack.slice(stack.indexOf(v)), v]);
      else if (c === WHITE) dfs(v);
    }
    stack.pop();
    color.set(u, BLACK);
  };

  for (const f of g.files) if ((color.get(f) ?? WHITE) === WHITE) dfs(f);
  return cycles;
}

/* ------------------------------------------------------------ 门禁 */

const GRAPH = buildGraph();
const CYCLES = findCycles(GRAPH);

describe("模块图：不得存在循环依赖", () => {
  it("src/ 下无循环依赖", () => {
    const pretty = CYCLES.map((c) => "  " + c.map((f) => f.replace(/^src\//, "")).join(" → "));
    expect(
      CYCLES.length,
      `发现 ${CYCLES.length} 处循环依赖：\n${pretty.join("\n")}\n\n` +
        `循环的运行时后果是模块可能拿到未初始化的导出（TDZ），\n` +
        `且打包器无法摇掉环上任何代码。`,
    ).toBe(0);
  });

  it("re-export 也算边（只查 import 会漏掉 basepath 那类环）", () => {
    // 回归锚点：basepath 曾 `export { isLocalhost } from "../ui/auth-pages.js"`，
    // 而 auth-pages → http → basepath。只匹配 `import` 的检测器看不到这条边。
    const b = GRAPH.edges.get("src/basepath/index.ts") ?? [];
    expect(
      b.some((t) => t.includes("/ui/")),
      "basepath 不得依赖 UI 层：否则只用 basepath 的 Worker 会被打进整个 UI",
    ).toBe(false);
  });

  it("纯工具模块 basepath 的依赖数保持很小", () => {
    // 数字会变，但量级不该变：basepath 是最底层的路径工具
    const b = GRAPH.edges.get("src/basepath/index.ts") ?? [];
    expect(b.length, `basepath 依赖过多：${b.join(", ")}`).toBeLessThanOrEqual(3);
  });

  it("config/requirements 不再依赖 config/index（否则与 export * 成环）", () => {
    const r = GRAPH.edges.get("src/config/requirements.ts") ?? [];
    expect(r, "requirements 只能依赖 types").not.toContain("src/config/index.ts");
  });

  it("所有相对 import 都能解析到真实文件（防止写错路径后静默失效）", () => {
    const unresolved: string[] = [];
    const re = /^\s*(?:import|export)\s+(?:type\s+)?[\s\S]*?from\s+"(\.[^"]+)"/gm;
    for (const f of GRAPH.files) {
      for (const m of readFileSync(f, "utf8").matchAll(re)) {
        if (!resolveLocal(f, m[1]!)) unresolved.push(`${f} → ${m[1]}`);
      }
    }
    expect(unresolved, `无法解析的相对导入：\n${unresolved.join("\n")}`).toEqual([]);
  });
});

describe("Tree-Shaking 标记（KIT-OPT-03）", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as Record<string, unknown>;

  it("package.json 声明 sideEffects: false", () => {
    // 只有显式声明，打包器才敢摇掉"看起来没被引用"的模块
    expect(pkg.sideEffects, "缺少 sideEffects: false，打包器无法摇树").toBe(false);
  });

  it("声明与事实相符：没有模块加载即执行的顶层副作用", () => {
    // 声明 sideEffects: false 是一句承诺。若某个模块在顶层改了全局状态，
    // 摇掉它就会出问题 —— 而这种问题只在特定打包配置下暴露。
    //
    // 判定方法：看**顶层**语句（不在函数/类体内）是否有赋值型副作用。
    // 函数体内的 console.* 是正常业务日志，不算。
    const offenders: string[] = [];
    for (const f of GRAPH.files) {
      const src = readFileSync(f, "utf8");
      let depth = 0;
      src.split("\n").forEach((raw, i) => {
        const line = raw.replace(/\/\/.*$/, "").trim();
        if (depth === 0 && /^(globalThis\.\w+\s*=|process\.env\.\w+\s*=)/.test(line)) {
          offenders.push(`${f}:${i + 1} ${line.slice(0, 60)}`);
        }
        // 粗略的花括号深度：足以区分顶层与函数体
        depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
        if (depth < 0) depth = 0;
      });
    }
    expect(
      offenders,
      `这些顶层赋值会让 sideEffects: false 的声明失真：\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("每个子路径导出都指向真实文件", () => {
    const exportsField = pkg.exports as Record<string, unknown> | undefined;
    if (!exportsField) return; // 未配置子路径导出时无需检查
    const bad: string[] = [];
    for (const [sub, val] of Object.entries(exportsField)) {
      const targets: string[] = [];
      const collect = (v: unknown): void => {
        if (typeof v === "string") targets.push(v);
        else if (v && typeof v === "object") Object.values(v).forEach(collect);
      };
      collect(val);
      for (const t of targets) {
        if (t.includes("*")) continue;
        try {
          statSync(t);
        } catch {
          bad.push(`${sub} → ${t}`);
        }
      }
    }
    expect(bad, `导出指向不存在的文件：\n${bad.join("\n")}`).toEqual([]);
  });
});

describe("模块图本身是自洽的（门禁不能自己坏掉）", () => {
  it("图的节点数与 src 下的 .ts 文件数一致", () => {
    expect(GRAPH.files.length).toBeGreaterThan(50);
    expect(GRAPH.edges.size).toBe(GRAPH.files.length);
  });

  it("环检测能真的检出环（用一个构造出来的环自证）", () => {
    // 一个永远"无环"的检测器会让上面所有断言变成空断言 ——
    // 历史上就发生过正则参数写反导致全部用例"通过"却什么都没测。
    const fake: Graph = {
      files: ["a.ts", "b.ts", "c.ts"],
      edges: new Map([
        ["a.ts", ["b.ts"]],
        ["b.ts", ["c.ts"]],
        ["c.ts", ["a.ts"]],
      ]),
      crossLayer: [],
    };
    expect(findCycles(fake).length, "构造出的环应被检出").toBe(1);
  });

  it("无环图确实检不出环", () => {
    const acyclic: Graph = {
      files: ["a.ts", "b.ts", "c.ts"],
      edges: new Map([
        ["a.ts", ["b.ts"]],
        ["b.ts", ["c.ts"]],
        ["c.ts", []],
      ]),
      crossLayer: [],
    };
    expect(findCycles(acyclic).length).toBe(0);
  });
});
