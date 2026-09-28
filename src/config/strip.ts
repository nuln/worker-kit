/**
 * @nuln/worker-kit/config — 注释与字符串剥离
 *
 * 供 {@link import("./scan.js").scanEnvAccess} 使用。
 *
 * ## 为什么需要
 *
 * 静态扫描最大的噪声来源是**注释与文档字符串里的示例代码**。本仓库 TSDoc 密度很高，
 * 注释里几乎每段都写着 `env.AUTH_SESSION_DO_SECRET` 之类的示例 —— 若不剥离，
 * 检查会把文档里提到的几十个变量全列成"缺失"，结果立刻失去意义、被人关掉。
 *
 * ## 一个真实踩过的坑：不认识正则字面量会吞掉整个文件的后半段
 *
 * 剥离器最初只处理注释与字符串，遇到 `/` 就当普通代码。结果这一行：
 *
 * ```ts
 * const INDEXED_RE = /env\s*\[\s*["'`]([A-Za-z_$]*)["'`]\s*\]/g;
 * ```
 *
 * 字符类 `["'`]` 里的 `'` 被当成"字符串开始"，于是一路向后找下一个 `'`，
 * 把中间所有 `/* ... *\/` 注释全部当成字符串内容**原样保留**。
 * 后果是 TSDoc 里举例的 `env.AUTH_SESSION_DO_SECRET` 被误判为真实访问，
 * 检查结论完全失真 —— 而且**报错点在几百行之外**，极难定位。
 *
 * 因此这里实现了一个带**正则字面量识别**的迷你词法器。
 *
 * ## 实现：默认留白 + 只拷贝代码区
 *
 * 输出先全部填成空白（换行保留），再把**代码区**字符拷贝回去。
 * 这样不需要在"当前是否在字符串里"上维护易错状态，偏移与原文天然一致，
 * 行列号可信。
 *
 * 模板字符串是唯一需要区分的：`` `前缀 env.FOO ${env.BAR} 后缀` `` 中
 * 字面量部分要抹掉、`${}` 内是**真实代码**必须保留，因此插值递归处理。
 *
 * ## 正则 / 除法的判别
 *
 * 靠两个信号（标准启发式，非完整语法分析）：
 *
 * 1. 前一个有效字符是**标点**（`(` `,` `=` `:` `[` `{` `;` `+` `-` `&&` …）→ 视为正则
 * 2. 前一个**词**是关键字（`return` `typeof` `case` `new` `await` …）→ 视为正则
 *
 * 否则（前一个是标识符、数字或 `)` `]`）→ 视为除法。
 *
 * 已知不精确：`if (x) /re/.test(s)` 这类会被判成除法。实际代码中该写法罕见，
 * 且判错的后果只是**少抹一点**噪声，不会让检查给出错误结论。
 *
 * @packageDocumentation
 */

/** 出现在这些标点之后时，`/` 开启正则字面量 */
const PUNCT_ALLOWS_REGEX = new Set([
  "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%",
  "^", "~", "<", ">", "\n", "",
]);

/** 出现在这些关键字之后时，`/` 开启正则字面量 */
const KEYWORD_ALLOWS_REGEX = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "case", "do", "else", "yield", "await", "throw",
]);

/**
 * 把注释、字符串字面量、正则字面量替换为等长空白，保留代码与换行。
 *
 * 模板字符串的 `${…}` 插值视为代码并保留。
 *
 * @param src 源码文本
 * @returns 与输入等长、换行位置一致的"纯代码"文本
 */
export function stripCommentsAndStrings(src: string): string {
  const n = src.length;
  // 默认全部留白；换行保留以维持行号
  const out: string[] = new Array<string>(n);
  for (let i = 0; i < n; i++) out[i] = src.charCodeAt(i) === 10 ? "\n" : " ";

  /** 把 [from, to) 标记为代码（拷贝回原文） */
  const keep = (from: number, to: number): void => {
    for (let k = from; k < to && k < n; k++) out[k] = src[k]!;
  };

  /** 最后一个非空白**词**（标识符/关键字/数字） */
  let lastWord = "";
  /** 最后一个非空白**字符** */
  let lastChar = "";

  /** `/` 是否开启正则字面量 */
  const regexAllowed = (): boolean => {
    if (lastWord) return KEYWORD_ALLOWS_REGEX.has(lastWord);
    return PUNCT_ALLOWS_REGEX.has(lastChar);
  };

  let i = 0;
  while (i < n) {
    const c = src[i]!;
    const c2 = i + 1 < n ? src[i + 1]! : "";

    if (c === "\n") {
      out[i] = "\n";
      lastChar = "\n";
      lastWord = "";
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      out[i] = c;
      i++;
      continue;
    }

    if (c === "/" && c2 === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? n : nl;
      continue;
    }
    if (c === "/" && c2 === "*") {
      const close = src.indexOf("*/", i + 2);
      i = close === -1 ? n : close + 2;
      lastChar = "/";
      lastWord = "";
      continue;
    }
    if (c === "/" && regexAllowed()) {
      i = skipRegex(src, i);
      lastChar = "/";
      lastWord = "";
      continue;
    }
    if (c === "'" || c === '"') {
      const end = skipQuoted(src, i, c);
      if (isEnvIndexQuote(src, i)) {
        // `env["FOO"]` 的索引字符串必须整体保留 —— 它不是无关字面量，而是变量名本身
        keep(i, end);
      } else {
        // 保留首尾引号、只抹掉内部内容。
        // 原因：分类判定需要知道"比较对象是个字面量"——
        // `env.FOO === "modern"` 是取值检查（守卫），若把引号一起抹掉，
        // 文本变成 `env.FOO ===` ，比较对象消失，该守卫就会被漏判。
        keep(i, i + 1);
        if (end - 1 > i) keep(end - 1, end);
      }
      i = end;
      lastChar = c;
      lastWord = "";
      continue;
    }
    if (c === "`") {
      const end = scanTemplate(src, i, keep);
      // 同样保留首尾反引号：`env.FOO === \`x\`` 里的模板字面量也是比较对象
      keep(i, i + 1);
      if (end - 1 > i) keep(end - 1, end);
      i = end;
      lastChar = "`";
      lastWord = "";
      continue;
    }

    // 标识符 / 关键字：整体拷贝并记为 lastWord
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j]!)) j++;
      keep(i, j);
      lastWord = src.slice(i, j);
      lastChar = src[j - 1]!;
      i = j;
      continue;
    }
    // 数字
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[0-9a-fA-FxXoObBnE_.+-]/.test(src[j]!)) j++;
      keep(i, j);
      lastChar = src[j - 1]!;
      lastWord = "";
      i = j;
      continue;
    }

    out[i] = c;
    lastChar = c;
    lastWord = "";
    i++;
  }

  return out.join("");
}

/** 跳过正则字面量（正确处理字符类与转义），返回其后的位置 */
function skipRegex(src: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    // 正则不能跨行：未闭合说明这其实是除号
    if (ch === "\n") return i;
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) {
      i++;
      while (i < src.length && /[a-z]/.test(src[i]!)) i++; // 消费 /foo/gi 的标志位
      return i;
    }
    i++;
  }
  return src.length;
}

/** 判断一个引号是否位于 `env[` 之后 —— 是则它是变量名，不可抹除 */
function isEnvIndexQuote(cleaned: string, quoteIdx: number): boolean {
  let k = quoteIdx - 1;
  while (k >= 0 && /\s/.test(cleaned[k]!)) k--;
  return k >= 0 && cleaned[k] === "[";
}

/** 跳过字符串字面量；未闭合时止于行尾，避免一张不匹配的引号吞掉整份文件 */
function skipQuoted(src: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    if (ch === "\n") return i;
    i++;
  }
  return src.length;
}

/**
 * 跳过模板字符串，把其中的 `${…}` 插值标记为代码。
 *
 * @param keep 把插值区间标记为代码的回调
 * @returns 闭合反引号之后的位置
 */
function scanTemplate(
  src: string,
  start: number,
  keep: (from: number, to: number) => void,
): number {
  let i = start + 1;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") return i + 1;
    if (ch === "$" && src[i + 1] === "{") {
      const exprStart = i + 2;
      let depth = 1;
      let j = exprStart;
      while (j < src.length && depth > 0) {
        const d = src[j]!;
        const d2 = j + 1 < src.length ? src[j + 1]! : "";
        if (d === "'" || d === '"') {
          j = skipQuoted(src, j, d);
          continue;
        }
        if (d === "`") {
          j = scanTemplate(src, j, keep);
          continue;
        }
        if (d === "/" && d2 === "/") {
          const nl = src.indexOf("\n", j);
          j = nl === -1 ? src.length : nl;
          continue;
        }
        if (d === "/" && d2 === "*") {
          const cl = src.indexOf("*/", j + 2);
          j = cl === -1 ? src.length : cl + 2;
          continue;
        }
        // 插值里的正则可能含 `}`，不跳过就会把花括号配平算错
        if (d === "/") {
          const e = skipRegex(src, j);
          if (src[e] !== "\n") {
            j = e;
            continue;
          }
        }
        if (d === "{") depth++;
        else if (d === "}") depth--;
        j++;
      }
      // 退出时 j 指向 `}` 之后，keep 需排除闭合花括号本身
      keep(exprStart, Math.min(j - 1, src.length));
      // 注意：必须是 i = j 而不是 j + 1 —— j 已经越过 `}`，
      // 再 +1 会把紧随其后的字符（可能是闭合反引号）一并跳过，
      // 导致模板无法闭合、词法状态失步（曾导致后续 TSDoc 里的示例
      // `env.AUTH_SESSION_DO_SECRET` 被误判为真实访问）。
      i = j;
      continue;
    }
    i++;
  }
  return src.length;
}
