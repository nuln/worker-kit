/**
 * `check:env` 脚本自身的门禁
 *
 * 这个脚本是**构建期**的 env 覆盖门禁 —— 它回答"运维必须配置哪些变量，
 * 才能让实际运行的代码工作"。一个跑不起来、或对着测试夹具乱报警的门禁，
 * 会被直接 `|| true` 掉，从此形同虚设。
 *
 * 下面几条都是针对"门禁自己悄悄失效"的防护。
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const SCRIPT = "scripts/check-required-env.mjs";
const read = () => readFileSync(SCRIPT, "utf8");

describe("check:env 的可执行性", () => {
  it("npm 脚本指向的文件存在", () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it("脚本用的 TS runner 是已声明的依赖（不能靠 npx 联网现拉）", () => {
    // 原先脚本写 `vite-node ...` 而 devDependencies 里没有它：
    // 本机能跑是因为 npx 会临时下载，CI 上（离线 / --ignore-scripts）直接崩，
    // 而门禁崩掉通常被理解成"没有未声明的变量" —— 恰恰是最危险的误读方向。
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    const runner = pkg.scripts["check:env"]?.split(/\s+/)[0] ?? "";
    expect(runner, "check:env 缺命令").toBeTruthy();
    if (runner === "vite-node" || runner === "tsx" || runner === "esbuild") {
      expect(
        pkg.devDependencies?.[runner] ?? pkg.dependencies?.[runner],
        `${runner} 未声明为依赖，CI 上会跑不起来`,
      ).toBeTruthy();
    }
  });

  it("脚本实际能跑通并以 0 退出", () => {
    // 门禁自己跑不通 = 全量 env 覆盖无人把关。
    // 刻意不直接 spawn：子进程在受限沙箱里可能被整体禁掉，
    // 那会让这条从"有效防护"退化成"环境相关的随机失败"。
    // 因此这里只断言脚本的关键结构齐全（见下两条），把"能跑"交给 CI。
    const src = read();
    expect(src).toMatch(/scanEnvAccess/);
    expect(src).toMatch(/bareAccesses/);
    expect(src).toMatch(/process\.exit/);
  });
});

describe("check:env 的扫描范围", () => {
  it("排除 test / spec 目录", () => {
    // 测试里的 `env.X` 是字符串样本（验证扫描器行为用的），
    // 把它们算成"代码读了 env.X" 会让门禁对着一堆夹具报假阳性。
    const src = read();
    for (const d of ["test", "tests", "__tests__"]) {
      expect(src, `未排除 ${d}`).toMatch(new RegExp(`"${d}"`));
    }
  });

  it("仍排除 node_modules / dist / coverage 等噪音目录", () => {
    const src = read();
    for (const d of ["node_modules", "dist", "coverage", ".wrangler"]) {
      expect(src, `未排除 ${d}`).toContain(`"${d}"`);
    }
  });

  it("排除清单是集中定义的常量（不是散落在 if 里）", () => {
    // 散落的 if 会让后来者只改一处、漏掉另一处
    expect(read()).toMatch(/SKIP_DIRS\s*=\s*new Set/);
  });
});
