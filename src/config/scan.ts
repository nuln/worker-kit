/**
 * @nuln/worker-kit/config — 环境变量访问扫描
 *
 * ## 要解决的问题
 *
 * 前置检查若完全依赖人工声明 `requirements`，就永远会有**"没声明的那一个"**：
 * 开发者新读了一个 `env.FOO` 却忘了登记，`/setup` 不会拦、CI 也不会报 ——
 * 而这正是最危险的一类配置缺陷（用户配完 Passkey 才发现邮件根本没发出去）。
 *
 * Worker **运行时**无法枚举"代码将要读哪些变量"：平台只给一个 `env` 对象，
 * 没有"已配置 / 未配置"清单。所以"把**你没发现**的那部分也暴露出来"
 * 只能在**构建期**做 —— 静态扫描源码里对 `env` 的访问，与实际配置比对。
 *
 * ## 分类判定
 *
 * 每处访问按**该访问点自身的语法**归入三类：
 *
 * | 类别 | 判定依据 | 是否必须配置 |
 * |---|---|---|
 * | `defaulted` | `env.FOO ?? x` / `\|\| x` / `?.` / 解构带默认值 | 否（已有兜底） |
 * | `guarded`   | 同名访问在**邻近作用域**内被判空 / `typeof` 检查 | 否（代码自己处理缺失） |
 * | `bare`      | 以上都没有 | **是 —— 候选必需项** |
 *
 * 同一变量在文件不同位置可以有不同的类别；汇总时取**最严格**的（`bare` 胜出）。
 * 因为一处裸访问就足以在未配置时炸掉。
 *
 * ## `bare` 是候选，不是结论
 *
 * 静态分析无法证明运行时一定需要它（该分支可能永远走不到、可能被上游中间件
 * 拦截）。因此本模块定位是"**把人工登记漏掉的部分暴露出来**"，
 * 由人确认后并入 `requirements` —— 而不是自动当成错误。
 *
 * ## 用法
 *
 * ```ts
 * import { scanEnvAccess, reportUndeclaredEnv } from "@nuln/worker-kit/config";
 *
 * const accesses = scanEnvAccess(sourceText, "src/index.ts");
 * const missing  = reportUndeclaredEnv(accesses, { vars: [...], bindings: [...] });
 * // missing: [{ name: "FOO", kind: "bare", locations: ["src/index.ts:12"] }, …]
 * ```
 *
 * CLI 见 kit 仓库 `scripts/check-required-env.mjs`。
 *
 * @packageDocumentation
 */

import { stripCommentsAndStrings } from "./strip.js";

/** 访问类别。 */
export type EnvAccessKind =
  /** 有兜底（`??` / `||` / `?.` / 解构默认值）—— 缺失不影响功能 */
  | "defaulted"
  /** 邻近作用域有判空 / typeof / 布尔守卫 —— 代码自己处理缺失 */
  | "guarded"
  /** 裸访问 —— 候选必需项 */
  | "bare";

export interface EnvAccess {
  /** 环境变量 / 绑定名 */
  name: string;
  /** 汇总类别（多处访问取最严格者） */
  kind: EnvAccessKind;
  /** 出现次数 */
  count: number;
  /** 出现位置（`file:line`，最多 5 处），便于人工确认 */
  locations: string[];
  /**
   * 每个访问点的类别统计：`{ defaulted: 2, bare: 1 }`。
   * 汇总 `kind` 取最严格者，但这个分布能让人一眼看出
   * "这个变量大部分地方有兜底、只有一处裸访问"。
   */
  kinds?: Partial<Record<EnvAccessKind, number>>;
  /**
   * 正是这些位置把 `kind` 判成了 `bare`（仅当 `kind === "bare"` 时填充）。
   *
   * 报告里必须给出**这一组**位置，而不是随便前几个 —— 一个变量在 17 处被访问、
   * 其中只有 1 处没有兜底时，指出那 1 处才有意义。
   */
  bareLocations?: string[];
}

export interface ScanOptions {
  /**
   * 认定"这是环境变量名"的形状。默认全大写（`DB` / `RATE_LIMITER_DO`），
   * 与本工作区的 wrangler 命名惯例一致。传 `null` 关闭过滤。
   */
  namePattern?: RegExp | null;
  /** 每条记录最多保留的位置数，默认 5 */
  maxLocations?: number;
}

/**
 * `env.FOO`（成员访问）
 *
 * **排除 `process.env.X` / `import.meta.env.X`** —— 那是 Node 与构建期变量
 * （`DEBUG_SERVER`、`HEADED`、`VITEST_*` …），与 Cloudflare 绑定无关。
 * 不过滤会把测试与构建脚本里的每个变量都报成"漏配"。
 *
 * 排除方式：匹配时带上前缀捕获组，若前缀是 `process.` / `import.meta.` 则跳过。
 */
const MEMBER_RE = /(?:(process|import\.meta)\s*\.\s*)?env\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)/g;
/** `env?.FOO` —— 可选链，天然有兜底（同样排除 process.env） */
const OPTIONAL_MEMBER_RE = /(?:(?:process|import\.meta)\s*\.\s*)?env\s*\?\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)/g;
/**
 * `env?.["FOO"]` —— 可选链 + 索引访问（合法 JS，此前完全漏掉）。
 *
 * 注意 `?.` 里的**点不能省**：`env?.[` 是 `?` `.` `[` 三个字符，
 * 写成 `env\s*\?\s*\[` 会永远匹配不上（写这个正则时先踩了一次）。
 */
const OPTIONAL_INDEXED_RE = /(?:(?:process|import\.meta)\s*\.\s*)?env\s*\?\s*\.\s*\[\s*["'`]([A-Za-z_$][A-Za-z0-9_$]*)["'`]\s*\]/g;
/** `env["FOO"]` / `env['FOO']` / `env[\`FOO\`]` */
const INDEXED_RE = /env\s*\[\s*["'`]([A-Za-z_$][A-Za-z0-9_$]*)["'`]\s*\]/g;
/** 解构：`const { FOO, BAR = "x" } = env` */
const DESTRUCTURE_RE = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*env\s*(?:;|$)/g;

const DEFAULT_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/** 严格程度：数值越大越严格，汇总取 max */
const SEVERITY: Record<EnvAccessKind, number> = { defaulted: 0, guarded: 1, bare: 2 };

/** 该访问点之后是否紧跟兜底操作符（`??` / `||` / `?.`） */
function defaultedAfter(cleaned: string, endIndex: number): boolean {
  return /^\s*(?:\?\?|\|\||\?\.)/.test(cleaned.slice(endIndex, endIndex + 4));
}

/**
 * 该访问点之前是否紧邻兜底操作符 —— 即它是 `??` / `||` 链的**后续项**。
 *
 * `a ?? b ?? env.FOO` 里只有 `a` 后面跟着 `??`，但整条链都有兜底，
 * 只看后缀会把 `env.FOO` 误判为裸访问。
 */
function defaultedBefore(cleaned: string, startIndex: number): boolean {
  return /(?:\?\?|\|\|)\s*$/.test(cleaned.slice(Math.max(0, startIndex - 4), startIndex));
}

/**
 * 该访问点是否是一次**写入**（`env.FOO = x` / `env.FOO++` / `delete env.FOO`）。
 *
 * 写入不需要变量"事先已配置"——`env.FOO = 1` 是**声明**，把它算成读取
 * 会让门禁要求运维去配置一个代码自己会创建的变量。
 *
 * @param startIndex 访问的**起点**（`env` 之前的位置）。
 *   `delete` 探针必须以它为基准：`delete env.FOO` 里 `delete` 出现在 `env` 之前，
 *   而访问的 `endIndex` 落在 `FOO` 之后 —— 用 endIndex 取窗口会以变量名结尾，
 *   `delete` 永远落在窗口之外（这正是该探针此前是死代码的原因）。
 */
function isWriteAt(cleaned: string, startIndex: number, endIndex: number): boolean {
  // 窗口取 6 字符：最长的赋值运算符 `>>>=` 连同前导空白需要这么长。
  const after = cleaned.slice(endIndex, endIndex + 6);
  /**
   * 赋值运算符：复合赋值（`+= -= *= /= %= **= <<= >>= >>>= &= |= ^=`）
   * 与逻辑赋值（`&&= ||= ??=`），以及裸 `=`。
   *
   * 两点必须同时满足，缺一不可：
   * 1. **复合赋值必须一并识别**。只认裸 `=` 时 `env.Counter += 1` 会被记成
   *    一次**读取**，门禁进而要求运维去配置一个代码自己会自增的变量。
   * 2. **`=` 后面不能再跟 `=` 或 `>`**。否则 `env.Q == 1`（比较）
   *    与 `const f = () => env.S`（箭头函数）都会被误判为写入，
   *    那会把真实的配置读取从门禁视野里抹掉。
   */
  const compound = String.raw`(?:>>>|<<|>>|\*\*|&&|\|\||\?\?|[+\-*/%&|^])=(?![=>])`;
  if (new RegExp(String.raw`^\s*(?:${compound}|=(?![=>]))`).test(after)) return true;
  if (/^\s*(?:\+\+|--)/.test(after)) return true;
  // `delete env.FOO` / `delete env["FOO"]`：看访问**之前**是否以 `delete ` 收尾
  if (/\bdelete\s+$/.test(cleaned.slice(Math.max(0, startIndex - 40), startIndex))) return true;
  return false;
}

const SCOPE_WINDOW = 300;

/** 从 `(` 反向配对到对应的 `)`，用于把 `if (…) { … }` 的条件纳入作用域 */
function matchingOpenParen(text: string, closeIdx: number): number {
  let depth = 0;
  for (let i = closeIdx; i >= 0; i--) {
    const c = text[i];
    if (c === ")") depth++;
    else if (c === "(") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * 从一个 `)` 位置向前扩展，返回包含 `if (cond)` 关键字的起点。
 *
 * 探针靠 `if (NAME` 识别条件守卫，因此**必须一路带回关键字** ——
 * 只退到 `(` 会把 `if` 裁掉，`if (!env.FOO) { return; } use(env.FOO)`
 * 就会被误判为裸访问。
 *
 * @returns 扩展后的起点；`closeIdx` 不是 `)` 时返回 -1
 */
function expandToConditionStart(cleaned: string, closeIdx: number): number {
  if (cleaned[closeIdx] !== ")") return -1;
  const open = matchingOpenParen(cleaned, closeIdx);
  if (open === -1) return -1;
  // 跳过 `!` 与空白，因为条件常写成 `if (!env.FOO)`
  let k = open - 1;
  while (k >= 0 && /[\s!]/.test(cleaned[k]!)) k--;
  const before = cleaned.slice(Math.max(0, k - 6), k + 1);
  const kw = /\b(if|while|for|switch|catch)$/.exec(before);
  return kw ? Math.max(0, k + 1 - kw[0].length) : open;
}

/**
 * 取出访问点所在逻辑块的文本。
 *
 * 两种扩展，都必须把 `if (…)` 的**条件连同关键字**一起纳入 ——
 * `if (opts?.env?.UI_THEME === "modern") { return opts.env.UI_THEME; }`
 * 的守卫写在条件里，只看块内会漏判为裸访问。
 */
function extractScope(cleaned: string, index: number): string {
  const brace = cleaned.lastIndexOf("{", index);
  const paren = cleaned.lastIndexOf(")", index);
  let start = Math.max(0, index - SCOPE_WINDOW, brace, paren);

  // ① `{` 前面紧跟 `)` → 那是 `if (…) { … }` 的条件，纳入作用域。
  //    判定用 brace 自身的合法性，不能拿已 max 过的 start 比 ——
  //    那会让 `brace > start` 恒为假、条件永远展不宽（曾导致 UI_THEME 被误判为裸访问）。
  if (brace > 0) {
    let k = brace - 1;
    while (k >= 0 && /\s/.test(cleaned[k]!)) k--;
    if (k >= 0) {
      const widened = expandToConditionStart(cleaned, k);
      if (widened !== -1) start = Math.min(start, widened);
    }
  }

  // ② 起点本身落在 `)` 上（如 `if (X) return Y;` 这种无花括号形态），
  //    同样要把条件与关键字带回来。
  const viaParen = expandToConditionStart(cleaned, start);
  if (viaParen !== -1) start = Math.min(start, viaParen);

  const closeAfter = cleaned.indexOf("}", index);
  const end = closeAfter === -1 ? Math.min(cleaned.length, index + SCOPE_WINDOW) : closeAfter;
  return cleaned.slice(start, end);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 收集"一跳局部别名"：`const webhookUrl = env.EMAIL_WEBHOOK_URL;`
 *
 * 极常见的写法是先把值取到局部变量、再对**局部变量**判空：
 *
 * ```ts
 * const webhookUrl = env.EMAIL_WEBHOOK_URL;
 * if (webhookUrl && webhookUrl.startsWith("http")) { … }
 * ```
 *
 * 守卫落在 `webhookUrl` 上，静态上看 `env.EMAIL_WEBHOOK_URL` 毫无保护 ——
 * 除非跟进这一跳数据流。因此把作用域内的一层直接赋值也纳入守卫判定。
 */
function aliasesInScope(scope: string, name: string): string[] {
  const n = escapeRe(name);
  const re = new RegExp(
    String.raw`(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:env\s*\??\.\s*)?${n}\s*[;,)\n]`,
    "g",
  );
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(scope)) !== null) if (m[1]) out.add(m[1]);
  return [...out];
}

/**
 * 对某个标识符构成"守卫"的全部形态。
 *
 * 三条关键约束，每条都对应一个真实误判：
 *
 * 1. **末尾加 `(?!\s*!)`**：后置 `!` 是 TypeScript 的非空断言，不是守卫。
 *    `call(env.FOO!, "x")` 恰恰表示"它一定存在"即必填；若当成守卫就会漏报。
 *    （前置 `!env.FOO` 才是逻辑非，由 probe 3 覆盖。）
 * 2. **三元 `?` 必须写成 `\?(?!\?)`**：否则 `env.FOO ?? 1` 里的第一个 `?`
 *    会被当成三元守卫 —— 而**兜底不是守卫**。这个误判的实际后果是：
 *    同一文件里另一行的裸访问被"隔空"判成有守卫，漏报。
 * 3. **不得把 `(` / `,` 当守卫前缀**：`use(env.FOO)`、`foo(a, env.FOO)`
 *    只是"把它当参数传"，代码并未检查它是否存在。
 *
 * 守卫的合法形态仅限：同一表达式内的 `&&` / `||` / 三元 / 比较运算、
 * 前置 `!` / `typeof`，以及 `if (…)` / `while (…)` 等控制语句的条件。
 */
function guardProbes(n: string): RegExp[] {
  const notAssertion = String.raw`(?!\s*!)`;
  // 三元的 ?，但排除 ?? 的第一个字符
  const ternary = String.raw`\?(?!\?)`;
  /**
   * 比较运算的**右侧必须是字面量**才算守卫。
   *
   * `env.FOO === undefined` / `== null` / `=== "modern"` 是"存在性/取值检查"，
   * 后面复用是安全的；而 `env.FOO === other` 只是与某个未知值比较，
   * 完全不能说明 FOO 存在 —— 若也算守卫，就是**漏报**，
   * 会让 CI 门禁形同虚设（实测 `if (env.FOO === other) {}` 曾被判为 guarded）。
   */
  const literal = String.raw`(?:undefined|null|true|false|["'\`]|[-+]?\d)`;
  return [
    // NAME && / NAME || / NAME 三元
    // 刻意**不含 `:`**：`case env.FOO:`（switch）、`{ k: env.FOO }`（对象字面量）、
    // `c ? 0 : env.FOO`（三元假分支）里的冒号都不是守卫。
    new RegExp(
      // 必须整体加括号：否则 `|` 的优先级会让 notAssertion 只挂在最后一个分支上
      String.raw`(?:` +
        String.raw`\b${n}\s*(?:&&|\|\||${ternary})\s*(?:[^=!<>]|$)` +
        String.raw`|\b${n}\s*(?:===|!==|==|!=)\s*${literal}` +
        String.raw`)` +
        notAssertion,
    ),
    // && NAME / || NAME / 三元 NAME
    new RegExp(String.raw`(?:&&|\|\||${ternary})\s*!?\s*\b${n}\b` + notAssertion),
    // if (NAME / while (NAME / for (…NAME / catch (NAME
    //
    // 必须排除"名字后面紧跟比较运算"的情形：`if (env.FOO === other)` 只是与某个
    // 未知值比较，完全不能说明 FOO 存在 —— 早先把这种当守卫，是一处**漏报**。
    // `if (env.FOO === undefined)` 仍会由上面的「与字面量比较」分支正确识别。
    new RegExp(
      String.raw`(?:if|while|for|catch)\s*\(\s*!?\s*\b${n}\b(?!\s*(?:===|!==|==|!=))` +
        notAssertion,
    ),
    // typeof NAME
    new RegExp(String.raw`typeof\s+${n}\b` + notAssertion),
  ];
}

/**
 * 邻近作用域内是否存在对 `name`（或其一层局部别名）的守卫。
 *
 * 窗口取访问点所在**逻辑块**：`{` … `}`（或 300 字符上限）。用块而非固定行数，
 * 是因为 `if (!env.FOO) { return … }` 与使用点常在同一行或紧邻，
 * 而"前面第 5 行判空、这里使用"这种跨度过大的启发式会产生假阴性。
 */
function guardedInScope(cleaned: string, index: number, name: string): boolean {
  const scope = extractScope(cleaned, index);
  const n = escapeRe(name);
  // 直接守卫：`env.NAME` 或可选链 `env?.NAME`（可选链本身也构成"存在性检查"）
  // 注意：\? 可选、\. 必选 —— 写成 (?:\?\.)? 会让裸 `env.FOO` 的点号无处可去
  for (const p of guardProbes(`env\\s*\\??\\.\\s*${n}`)) if (p.test(scope)) return true;
  // 对一层局部别名的守卫
  for (const alias of aliasesInScope(scope, name)) {
    for (const p of guardProbes(escapeRe(alias))) if (p.test(scope)) return true;
  }
  return false;
}

/** 综合该访问点的所有信号，判定类别 */
function classifyAt(
  cleaned: string,
  start: number,
  end: number,
  name: string,
  optionalChain = false,
): EnvAccessKind {
  // `env?.FOO` —— 整个 env 可选，缺失即 undefined，天然有兜底
  if (optionalChain) return "defaulted";
  if (defaultedAfter(cleaned, end)) return "defaulted";
  // `a ?? b ?? env.FOO` 的后续项同样有兜底
  if (defaultedBefore(cleaned, start)) return "defaulted";
  // 注：`env?.FOO` 不走到这里 —— MEMBER_RE 要求 `env` 后紧跟 `.`，
  // 而可选链是 `?.`，故它由 OPTIONAL_MEMBER_RE 单独捕获并直接传 optionalChain=true。
  // （曾在此处还有一个 optionalChainBefore 兜底，实测永不可达，已删除。）
  if (guardedInScope(cleaned, start, name)) return "guarded";
  return "bare";
}

/**
 * 扫描源码，返回全部 `env` 访问及分类。
 *
 * 会先剥离注释与字符串字面量 —— 否则文档注释和示例代码里的 `env.FOO`
 * 会被误判为真实访问，产生大量假阳性。
 *
 * @param source 源码文本
 * @param fileLabel 出现在 `locations` 中的文件名
 * @param opts 扫描选项
 */
export function scanEnvAccess(
  source: string,
  fileLabel = "source",
  opts: ScanOptions = {},
): EnvAccess[] {
  const maxLoc = opts.maxLocations ?? 5;
  const nameRe = opts.namePattern === undefined ? DEFAULT_NAME_PATTERN : opts.namePattern;
  const cleaned = stripCommentsAndStrings(source);
  const map = new Map<string, EnvAccess>();

  const record = (name: string, kind: EnvAccessKind, at: number) => {
    if (nameRe && !nameRe.test(name)) return;
    const loc = `${fileLabel}:${lineNo(cleaned, at)}`;
    const prev = map.get(name);
    if (prev) {
      prev.count += 1;
      prev.kinds ??= {};
      prev.kinds[kind] = (prev.kinds[kind] ?? 0) + 1;
      if (prev.locations.length < maxLoc) prev.locations.push(loc);
      // 只记下"判为 bare 的那些行"—— 报告要指的就是它们
      if (kind === "bare") {
        prev.bareLocations ??= [];
        if (prev.bareLocations.length < maxLoc) prev.bareLocations.push(loc);
      }
      // 汇总取最严格者：一处裸访问就足以在未配置时炸掉
      if (SEVERITY[kind] > SEVERITY[prev.kind]) prev.kind = kind;
    } else {
      map.set(name, {
        name,
        kind,
        count: 1,
        locations: [loc],
        kinds: { [kind]: 1 },
        ...(kind === "bare" ? { bareLocations: [loc] } : {}),
      });
    }
  };

  // 成员访问 env.FOO —— 第 1 组是 process/import.meta 前缀，有值即非 Worker env
  MEMBER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MEMBER_RE.exec(cleaned)) !== null) {
    if (m[1]) continue; // process.env.X / import.meta.env.X
    const name = m[2];
    if (!name) continue;
    const end = m.index + m[0].length;
    if (isWriteAt(cleaned, m.index, end)) continue;
    record(name, classifyAt(cleaned, m.index, end, name), m.index);
  }

  // 索引访问 env["FOO"] —— 只有一个捕获组（就是变量名）
  INDEXED_RE.lastIndex = 0;
  while ((m = INDEXED_RE.exec(cleaned)) !== null) {
    const name = m[1];
    if (!name) continue;
    const end = m.index + m[0].length;
    if (isWriteAt(cleaned, m.index, end)) continue;
    record(name, classifyAt(cleaned, m.index, end, name), m.index);
  }

  // 可选链访问 env?.FOO —— 天然有兜底
  OPTIONAL_MEMBER_RE.lastIndex = 0;
  let oc: RegExpExecArray | null;
  while ((oc = OPTIONAL_MEMBER_RE.exec(cleaned)) !== null) {
    const name = oc[1];
    if (!name) continue;
    const end = oc.index + oc[0].length;
    if (isWriteAt(cleaned, oc.index, end)) continue;
    record(name, classifyAt(cleaned, oc.index, end, name, true), oc.index);
  }

  // 可选链 + 索引访问 env?.["FOO"] —— 同样是合法访问，天然有兜底
  OPTIONAL_INDEXED_RE.lastIndex = 0;
  let oi: RegExpExecArray | null;
  while ((oi = OPTIONAL_INDEXED_RE.exec(cleaned)) !== null) {
    const name = oi[1];
    if (!name) continue;
    const end = oi.index + oi[0].length;
    if (isWriteAt(cleaned, oi.index, end)) continue;
    record(name, classifyAt(cleaned, oi.index, end, name, true), oi.index);
  }

  // 解构：{ FOO, BAR = "x" } = env
  DESTRUCTURE_RE.lastIndex = 0;
  let d: RegExpExecArray | null;
  while ((d = DESTRUCTURE_RE.exec(cleaned)) !== null) {
    const body = d[1]!;
    // pattern 自身的 `{` 位置 —— 供 enclosingBlock 跳过
    const ownBrace = cleaned.lastIndexOf("{", d.index);
    let off = 0;
    for (const rawPart of body.split(",")) {
      const part = rawPart.trim();
      if (!part) continue;
      const at = d.index + d[0].indexOf(rawPart, off);
      off = d[0].indexOf(rawPart, off) + rawPart.length;

      // 三种形态都要归一化出「环境变量名」与「有无默认值」：
      //   { FOO }              → 名字 FOO，无默认值
      //   { FOO = "x" }        → 名字 FOO，有默认值
      //   { FOO: local }       → 名字 FOO（冒号右边是**局部别名**，不是变量名），
      //   { FOO: local = "x" } → 名字 FOO，有默认值
      //   { ...FOO }           → 名字 FOO
      //
      // 曾把 `{ FOO: local }` 的名字算成字符串 "FOO: local"，
      // 结果既匹配不上命名形状、又让守卫判定拿一个不存在的名字去查 —— 整条访问直接消失。
      const eq = part.indexOf("=");
      const head = (eq === -1 ? part : part.slice(0, eq)).trim();
      const colon = head.indexOf(":");
      const name = (colon === -1 ? head : head.slice(0, colon))
        .replace(/^\.\.\./, "")
        .trim();
      const hasDefault = eq !== -1;
      if (!name) continue;

      // 解构自带默认值 → 一定有兜底；否则走统一判定
      record(name, hasDefault ? "defaulted" : classifyAt(cleaned, at, at, name), at);

      // 有局部别名时，把别名的守卫也算进来（`const { FOO: f } = env; if (f) …`）
      // 守卫通常写在下一行，因此作用域取**外层块**而非解构自身。
      if (colon !== -1) {
        const alias = head.slice(colon + 1).trim();
        if (!alias) continue;
        const block = enclosingBlock(cleaned, at, ownBrace);
        if (guardProbes(escapeRe(alias)).some((p) => p.test(block))) {
          const prev = map.get(name);
          if (prev && prev.kind === "bare") prev.kind = "guarded";
        }
      }
    }
  }

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** 从一个 `{` 位置正向配对到对应的 `}` */
function matchingBrace(text: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * 取访问点所在的**外层代码块**（跳过度 pattern 自身的花括号）。
 *
 * 解构场景专用：`const { FOO: local } = env;` 的守卫常写在**下一行**
 * （`if (local) { … }`），而 {@link extractScope} 取到的是解构自己的 `}` 就停了，
 * 看不到后面的守卫。`ownBrace` 用于告知哪个 `{` 是 pattern 自身的、需要跳过。
 */
function enclosingBlock(cleaned: string, index: number, ownBrace: number): string {
  let open = -1;
  for (let p = ownBrace - 1; p >= 0; p--) {
    if (cleaned[p] === "{") {
      open = p;
      break;
    }
  }
  // 没有更外层的块（如顶层解构）→ 回退到解构自身之后的一段窗口
  if (open === -1) return cleaned.slice(index, Math.min(cleaned.length, index + SCOPE_WINDOW));
  const close = matchingBrace(cleaned, open);
  return cleaned.slice(open, close === -1 ? cleaned.length : close);
}

function lineNo(s: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index && i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

/**
 * 从扫描结果中取出**候选必需项** —— 即 `bare` 类别的访问。
 *
 * 命名遵循 kit 规范（`src/conventions.ts`）：判定类函数用 `is*` 返回布尔、
 * 校验类用 `assert*` 抛错；本函数既不判定也不抛错，只是按类别筛选，
 * 因此用与 {@link EnvAccessKind} 词汇一致的 `bareAccesses`，
 * 而非会被门禁拦下的 `required*` 前缀。
 *
 * @param accesses 扫描结果
 * @returns 类别为 `bare` 的项 —— **候选**而非结论，仍需人工确认
 */
export function bareAccesses(accesses: EnvAccess[]): EnvAccess[] {
  return accesses.filter((a) => a.kind === "bare");
}

/** 已知配置清单（用于区分"代码读了但没配"与"配了但代码不用"） */
export interface ConfiguredKeys {
  /** wrangler.jsonc 声明的 vars 键 */
  vars?: string[];
  /** wrangler.jsonc 声明的绑定名 */
  bindings?: string[];
  /** 已注入的 secret / API key 名 */
  secrets?: string[];
}

/** 汇总"已配置"的所有键名 */
export function configuredKeySet(cfg: ConfiguredKeys = {}): Set<string> {
  return new Set([...(cfg.vars ?? []), ...(cfg.bindings ?? []), ...(cfg.secrets ?? [])]);
}

/**
 * 找出**代码裸访问、但配置清单里没有**的项 —— 即人工登记漏掉的部分。
 *
 * 这是本模块的核心价值：把"开发者新加了一个 `env.FOO` 却忘了登记"暴露出来。
 *
 * @param accesses 扫描结果
 * @param cfg 已知配置清单；**为空则直接返回空数组**（无从判断，不猜）
 */
export function reportUndeclaredEnv(
  accesses: EnvAccess[],
  cfg: ConfiguredKeys = {},
): Array<{ name: string; kind: EnvAccessKind; locations: string[] }> {
  const configured = configuredKeySet(cfg);
  // 没有清单可比对时不做臆测 —— 宁可少报也不误报
  if (configured.size === 0) return [];
  return bareAccesses(accesses)
    .filter((a) => !configured.has(a.name))
    .map((a) => ({ name: a.name, kind: a.kind, locations: a.locations }));
}

/**
 * 反向检查：配置清单里声明了、但代码**从未读取**的项。
 *
 * 通常是**残留配置**（重构后忘了清理）。注意判定用的是"有没有被读过"，
 * 而不是"有没有被裸访问"—— 带兜底的 `env.FOO ?? x` 同样是真实使用，
 * 若按裸访问判定，会把大量正常配置误报成残留。
 */
export function reportUnusedConfig(
  accesses: EnvAccess[],
  cfg: ConfiguredKeys = {},
): string[] {
  const read = new Set(accesses.map((a) => a.name));
  return [...configuredKeySet(cfg)].filter((k) => !read.has(k)).sort();
}
