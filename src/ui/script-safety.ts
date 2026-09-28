/**
 * @nuln/worker-kit/ui/script-safety
 *
 * SSR 内联脚本的注入安全工具（AGENTS §14.3 / §14.4）。
 *
 * ## 为什么不能直接用 JSON.stringify
 *
 * `<script>` 块的内容由 HTML 解析器先行扫描，遇到 `</script` 即**提前闭合**，
 * 后续内容会被当作普通 HTML 解析。而 `JSON.stringify` **不转义** `<`、`>`、`&`，
 * 因此：
 *
 * ```ts
 * const evil = '</script><script>window.__pwned=1</script>';
 * `<script>var B = ${JSON.stringify(evil)};</script>`
 * // → <script>var B = "</script><script>window.__pwned=1</script>";</script>
 * //   ↑ 脚本在此处被截断，后半段成为**可执行**的第二个 script 块 → XSS
 * ```
 *
 * 故凡是把外部输入（BASE_PATH、OIDC issuer、错误文案等）插值进 `<script>`，
 * 必须走 {@link safeJsonForScript}。
 *
 * @see AGENTS §14.4 —— `tsc` 无法校验模板字符串内的 JS，故必须有运行时测试兜底。
 */

/**
 * 供 `<script>` 内插值使用的安全 JSON 序列化。
 *
 * 在保持 JSON 语义等价的前提下，把会破坏 HTML 解析的字符转成等价的
 * `\uXXXX` 转义：
 * - `<` `>` `&`：阻断 `</script>` 提前闭合与 HTML 实体歧义；
 * - U+2028 / U+2029：JS 字符串字面量中的行终止符（JSON 允许但 JS 会抛语法错）。
 *
 * @param value 待序列化值；`undefined` 归一为 `null`（与 `JSON.stringify` 行为对齐）
 * @returns 可安全嵌入 `<script>` 的 JSON 字面量文本
 */
export function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * 清洗路由前缀：剔除可注入 HTML / JS / 属性上下文的字符。
 *
 * 用于**双重保险** —— 即便调用方忘了用 {@link safeJsonForScript}，
 * 经过本函数的前缀也无法携带 `"`、`<`、`>`、`&`、`\`。
 *
 * @param input 原始前缀（通常来自 `BASE_PATH` 环境变量）
 * @returns 清洗后的前缀
 */
export function sanitizeBasePrefix(input: unknown): string {
  return String(input || "").replace(/["'<>&\\]/g, "");
}

/**
 * 渲染 CSP nonce 属性（KIT-BUG-04）
 *
 * ## 为什么需要它
 *
 * 内联 `<script>` / `<style>` 在 `script-src 'nonce-xxx'` 且未开
 * `'unsafe-inline'` 的严格 CSP 下会被浏览器**直接阻断**。这类部署
 * （企业内网高安全等级、合规要求去掉 unsafe-inline）会让整个认证页
 * 不可用：WebAuthn 交互脚本不执行，样式全丢，页面像坏了一样 ——
 * 而服务端日志里什么都没有。
 *
 * 正确做法是每请求生成随机 nonce，输出到所有内联标签上，并放进
 * `Content-Security-Policy: script-src 'nonce-...'` 响应头。
 *
 * ## 边界
 *
 * - **未传或空串 → 不输出该属性**（向后兼容：不改变现有渲染结果）
 * - nonce 会被写进 HTML，必须转义 —— 它虽由服务端生成而非用户输入，
 *   但一旦某天改成从 `Request` 读取（如从上游反向代理透传），
 *   就立刻变成一个可注入点。故这里无条件转义。
 *
 * @param cspNonce 本次请求的 CSP nonce
 * @returns ` nonce="..."` 形式的属性前缀；无有效 nonce 时返回空串
 */
export function cspNonceAttr(cspNonce: string | undefined | null): string {
  const n = String(cspNonce ?? "").trim();
  if (!n) return "";
  return ` nonce="${escapeHtml(n)}"`;
}

/**
 * 给一段 HTML 里的所有 `<script>` / `<style>` 标签补上 nonce 属性。
 *
 * 模板字符串里散落着十几处 `<script>`，逐个手写条件插入极易漏 ——
 * 漏掉的那一个恰恰让页面在该 CSP 下失效，而症状是"部分功能不工作"，
 * 极难定位。故统一做一次**后处理**：渲染完成后扫描整段 HTML。
 *
 * ## 为什么必须做**状态机**扫描而不是正则替换
 *
 * 正则无法区分"标签"与"字符串字面量里的类标签文本"：
 *
 * ```html
 * <script>var s = "<script>x</script>";</script>
 * ```
 *
 * 这段 HTML 里只有**一个**真实的 `<script>` 标签（它没有 `>` 结束，
 * 后面那些是 JS 字符串内容）。而 `/<script[^>]*>/` 会匹配到 3 处，
 * 给字符串内容也加上 `nonce="..."` —— 于是 JS 源码被改写成
 * `var s = "<script nonce="NN">x</script>";`，**脚本当场语法错误**。
 *
 * 在真实页面里这不是理论问题：客户端注入的 `AUTH_SYNC_SCRIPT` 里就有
 * 大量含 `<` 的模板片段。故这里逐字符跟踪"当前是否在 script/style
 * 的内容区"，只在**真实标签**上插入。
 *
 * @param html 已渲染的完整 HTML
 * @param cspNonce 本次请求的 CSP nonce；无值时原样返回
 * @returns 补齐 nonce 的 HTML
 */
export function applyCspNonce(html: string, cspNonce: string | undefined | null): string {
  const attr = cspNonceAttr(cspNonce);
  if (!attr || !html) return html;

  let out = "";
  /** 当前是否处于 script/style 的内容区（内部只认结束标签） */
  let inRawText = false;
  let i = 0;

  while (i < html.length) {
    if (html[i] !== "<") {
      out += html[i];
      i++;
      continue;
    }

    const isEndTag = html.startsWith("</", i);
    const tagStart = isEndTag ? i + 2 : i + 1;
    const nameMatch = /^(script|style)/i.exec(html.slice(tagStart, tagStart + 6));
    const name = nameMatch?.[1]?.toLowerCase();

    if (name) {
      // 内容区里遇到结束标签：这是唯一的退出点。
      // 必须**先**判这个 —— 结束标签的 `<` 就在当前位置，
      // 交给下面的"寻找内容区结束"逻辑会从 i+1 开始找，恰好错过它。
      if (inRawText && isEndTag) {
        const close = findTagEnd(html, i);
        if (close === -1) {
          out += html.slice(i);
          break;
        }
        out += html.slice(i, close + 1);
        inRawText = false;
        i = close + 1;
        continue;
      }

      // 内容区里遇到其它 `<`（含脚本里的字符串字面量）：原样拷贝到
      // 真正的结束标签为止，绝不当作标签处理
      if (inRawText) {
        const end = findRawTextEnd(html, i, name);
        if (end === -1) {
          out += html.slice(i);
          break;
        }
        out += html.slice(i, end);
        i = end;
        continue;
      }

      // 标签起始处
      const close = findTagEnd(html, i);
      if (close === -1) {
        // 标签未闭合：原样保留剩余内容，不做任何猜测
        out += html.slice(i);
        break;
      }
      const tagText = html.slice(i, close + 1);
      const head = isEndTag ? `</${name}` : `<${name}`;
      const tail = tagText.slice(head.length);
      out += /\bnonce=/i.test(tail) ? tagText : `${head}${attr}${tail}`;
      if (!isEndTag && !/\/\s*>$/.test(tail)) inRawText = true;
      i = close + 1;
      continue;
    }

    // 普通标签：整体拷贝
    const close = findTagEnd(html, i);
    if (close === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, close + 1);
    i = close + 1;
  }

  return out;
}

/** 找到普通标签的 `>`；未找到返回 -1 */
function findTagEnd(html: string, from: number): number {
  for (let i = from + 1; i < html.length; i++) {
    if (html[i] === ">") return i;
  }
  return -1;
}

/**
 * 在 raw text 区（script/style 正文）里找 `</name` 的起始位置。
 *
 * 正则会失败的原因同上：正文里的 `>` 与 `</` 都只是数据。
 * 逐字符扫描到真正的结束标签即可。
 */
function findRawTextEnd(html: string, from: number, name: string): number {
  const needle = `</${name}`;
  for (let i = from + 1; i < html.length; i++) {
    if (html[i] !== "<") continue;
    if (html.slice(i, i + needle.length).toLowerCase() === needle) {
      const close = findTagEnd(html, i);
      return close === -1 ? -1 : i;
    }
  }
  return -1;
}

/** HTML 实体转义（与 auth-pages / topbar 内联实现保持一致） */
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
