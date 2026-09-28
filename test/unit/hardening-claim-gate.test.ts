/**
 * 门禁：注释声称的安全加固必须在代码里真正落地
 *
 * ## 这条门禁要防什么
 *
 * 本次补测试时在 `src/notify/drivers/` 里连续发现三处**同一个模式**：
 *
 * ```ts
 * // 出站请求加固：5s 超时 + 禁止自动跟随重定向。
 * // 默认的 redirect:"follow" 会让公网 URL 302 跳到内网地址，
 * // 使 assertSafePublicUrl 的 SSRF 首跳校验形同虚设。
 * const outboundSignal = AbortSignal.timeout(5000);
 *
 * res = await fetch(url, { method: "POST", body });   // ← signal 声明了却没用！
 * ```
 *
 * 以及：
 *
 * ```ts
 * // 缺少 result 字段时判为**失败**。
 * if (data.ok === false) { … }                        // ← 只判了 ok===false
 * ```
 *
 * ```ts
 * if (data.code !== undefined && Number(data.code) !== 200) { … }  // ← 缺字段反而成功
 * ```
 *
 * 三处的共同点：**注释把修复描述得清清楚楚，代码却只做了一半**。
 * 注释因此成了**反向的误导** —— 后续维护者读注释会以为"这里已经防住了"，
 * 不会再去看代码。而这类缺陷不会让成功路径失败，只在异常响应时暴露：
 * 告警被上报为"投递成功"，而消息从未送达。
 *
 * ## 为什么用门禁而不是逐条测试
 *
 * 逐条测试只能锁住已发现的三处。同样的"注释与代码脱节"还会发生在别处。
 * 门禁做的是**可机械判定**的那一类：
 *
 * 1. 凡声明了 `AbortSignal.timeout` / 超时变量，附近必须真的把它传给 fetch
 * 2. 凡注释提到 `redirect`，fetch 必须显式设置 `redirect`
 * 3. 凡注释声称"缺少 X 判为失败"，代码里必须有对应判定
 *
 * 判定不了的部分（自然语言里的"已加固"）交给 review 与测试用例。
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripCommentsAndStrings } from "../../src/config/strip.js";

/** 收集 src 下所有 .ts */
function collect(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) collect(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const FILES = collect("src");

/**
 * 取出某个文件里所有**服务端真实代码中**的 `fetch(` 调用的参数文本。
 *
 * 关键：先剥离注释与字符串，再在剥离结果上定位。因为 `src/ui/auth-pages.ts`
 * 之类文件里，浏览器端脚本是**嵌在模板字符串里**的 —— 那些 fetch 是同源请求，
 * 既不需要超时也不需要 `redirect: "manual"`，把它们算进来是误报。
 *
 * 剥离器保持与原文等长、换行位置一致，因此可以在剥离结果上定位偏移，
 * 再回到**原文**取参数文本（否则 `redirect: "manual"` 的值已被抹成空白）。
 */
function fetchCallArgs(src: string): string[] {
  const out: string[] = [];
  const code = stripCommentsAndStrings(src);
  const re = /\bfetch\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    let i = m.index + m[0].length;
    let depth = 1;
    let argStart = i;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      if (depth === 0) break;
      // 跳过字符串，避免括号出现在 URL 里导致配平错乱
      if (c === '"' || c === "'" || c === "`") {
        const q = c;
        i++;
        while (i < src.length && src[i] !== q) {
          if (src[i] === "\\") i++;
          i++;
        }
      }
      i++;
    }
    out.push(src.slice(argStart, i));
  }
  return out;
}

/** 取某变量声明所在行及其后 25 行（超时变量通常紧邻 fetch） */
function windowAround(src: string, varName: string): string {
  const re = new RegExp(`\\b(?:const|let|var)\\s+${varName}\\b`, "g");
  const m = re.exec(src);
  if (!m) return "";
  const lines = src.split("\n");
  const lineNo = src.slice(0, m.index).split("\n").length;
  return lines.slice(lineNo - 1, lineNo + 25).join("\n");
}

describe("门禁：出站请求的加固声明必须落地", () => {
  it("声明了超时变量的文件，必须真的把它传给 fetch", () => {
    const violations: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      const decls = [
        ...src.matchAll(/\b(?:const|let)\s+(\w*[Ss]ignal\w*|\w*[Tt]imeout\w*)\s*=/g),
      ].map((m) => m[1]!);
      if (decls.length === 0) continue;
      const calls = fetchCallArgs(src);
      if (calls.length === 0) continue;
      for (const d of decls) {
        // 该变量必须至少出现在一个 fetch 调用的参数里
        const used = calls.some((a) => new RegExp(`\\b${d}\\b`).test(a));
        if (!used) {
          violations.push(
            `${f}: 声明了 \`${d}\`（附近有注释声称超时加固），但没有任何 fetch 调用使用它`,
          );
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("注释提到 redirect 的出站调用，必须显式设置 redirect", () => {
    const violations: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      // 只检查注释里提到 redirect / 重定向 的文件
      if (!/redirect|重定向/.test(src)) continue;
      for (const args of fetchCallArgs(src)) {
        if (!/\bredirect\s*:/.test(args)) {
          violations.push(`${f}: 注释提到 redirect/重定向，但该 fetch 未设置 redirect 选项`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("所有 notify 驱动的出站请求都带 signal 与 redirect:manual", () => {
    const violations: string[] = [];
    for (const f of FILES.filter((x) => x.includes("/notify/drivers/"))) {
      const src = readFileSync(f, "utf8");
      const calls = fetchCallArgs(src);
      for (const args of calls) {
        if (!/\bsignal\s*:/.test(args)) violations.push(`${f}: fetch 缺少 signal（无超时保护）`);
        if (!/\ redirect\s*:\s*["']manual["']/.test(args)) {
          violations.push(`${f}: fetch 未设置 redirect:"manual"（SSRF 首跳校验会被绕过）`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});

describe("门禁：注释声称的 fail-closed 判定必须真的存在", () => {
  it("注释提到「缺少 X 判为失败/判失败」时，代码必须有对应判定", () => {
    const violations: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        if (!/^\s*(\*|\/\/)/.test(line)) return; // 只看注释行
        if (!/缺少[^。]*判(为)?失败|判为失败|一律判失败/.test(line)) return;
        // 往后看 20 行里必须出现条件判定。
        //
        // 窗口按**物理行**计即可：fix 的说明性注释常有十几行，
        // 若按"非注释行"计数则窗口会被注释吃光，反而漏判。
        // 取 20 行是权衡 —— 太小会因长注释误报（本次就撞到过），太大则约束变弱。
        const after = lines
          .slice(i + 1, i + 21)
          .filter((l) => !/^\s*(\*|\/\/)/.test(l))
          .join("\n");
        /**
         * 判定信号是「存在一个 if 分支返回失败」，而不是「守卫变量叫什么名字」。
         *
         * 早先只认 `!data`、`data.x === undefined` 这几种具体写法，
         * 结果 `if (tableCount === 0) return { success: false, … }` 被误报 ——
         * 探针越窄，假报越多，最后大家只会习惯性忽略它。
         */
        const hasGuard = new RegExp(
          "if\\s*\\([^)]*\\)[^{]*\\{[\\s\\S]{0,400}?" +
            // return false / return null / return { ok:false } / { success:false } / { error: … }
            "return\\s+(?:false|null|\\{[^}]*(?:ok|success)\\s*:\\s*false)",
        ).test(after);
        if (!hasGuard) {
          violations.push(
            `${f}:${i + 1} 注释声称"判失败"但 20 行内无对应判定 → ${line.trim().slice(0, 60)}`,
          );
        }
      });
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("业务字段缺失必须判失败（不得因字段 undefined 而落入成功分支）", () => {
    // 形如 `if (data.x !== undefined && data.x !== OK)` 的写法：
    // 字段缺失时条件为假 → 判成功，属于 fail-open
    const violations: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      // 形如 `data.x !== undefined && …`（前置）或 `… && data.x !== undefined`（后置）
      const re =
        /if\s*\([^)]*?(?:data|res\.json\(\))\??\.(\w+)\s*!==\s*undefined[^)]*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const lineNo = src.slice(0, m.index).split("\n").length;
        violations.push(
          `${f}:${lineNo} \`${m[1]} !== undefined && …\`：字段缺失时反而判成功（fail-open）`,
        );
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
