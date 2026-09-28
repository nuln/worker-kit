/**
 * CSP nonce 注入（KIT-BUG-04）
 *
 * ## 这组测试在防什么
 *
 * 严格 CSP（`script-src 'nonce-xxx'` 且无 `'unsafe-inline'`）下，
 * 未带 nonce 的内联 `<script>` / `<style>` 会被浏览器**直接阻断**。
 *
 * 症状极具迷惑性：页面能显示（HTML 结构正常），但
 * - WebAuthn 按钮点了没反应（脚本没执行）
 * - 样式全丢（`<style>` 被拦）
 * - **服务端日志里什么都没有**
 *
 * 而"所有标签都带上了 nonce"这件事无法靠肉眼确认 —— 模板里有十几处内联
 * 标签，漏一处就前功尽弃。所以这里用**计数**来断言。
 */

import { describe, it, expect } from "vitest";
import { applyCspNonce, cspNonceAttr, safeJsonForScript } from "../../src/ui/script-safety.js";
import { renderAuthPage, renderSetupHtml, renderLoginHtml } from "../../src/ui/auth-pages.js";
import {
  renderModernSetupHtml,
  renderModernLoginHtml,
  renderModernInviteHtml,
  renderModernRecoveryHtml,
  renderModernConsentHtml,
  renderModernSsoErrorHtml,
} from "../../src/ui/themes/modern/index.js";

const NONCE = "rAnd0mBase64Nonce123==";

/**
 * 统计未带 nonce 的**真实内联标签**（这就是"严格 CSP 下会失效"的标签数）。
 *
 * 不能直接用正则数 `</?script>`：脚本正文里常有 `<script>` 这样的
 * **注释文本**（本仓库的客户端脚本注释里就有），它们不是标签。
 * 正则会把注释也算进去，于是"全部带 nonce"永远无法通过，
 * 或者反过来让人放宽断言。故这里沿用与实现相同的状态机。
 */
function realTags(html: string): Array<{ tag: string; hasNonce: boolean }> {
  const out: Array<{ tag: string; hasNonce: boolean }> = [];
  let inRaw = false;
  let i = 0;
  while (i < html.length) {
    if (html[i] !== "<") { i++; continue; }
    const isEnd = html.startsWith("</", i);
    const name = /^(script|style)/i.exec(html.slice(isEnd ? i + 2 : i + 1, (isEnd ? i + 2 : i + 1) + 6))?.[1];
    if (name) {
      if (inRaw && isEnd) { inRaw = false; i++; continue; }
      if (inRaw) {
        const at = html.toLowerCase().indexOf(`</${name.toLowerCase()}`, i + 1);
        if (at === -1) break;
        i = at;
        continue;
      }
      const close = html.indexOf(">", i);
      if (close === -1) break;
      const tagText = html.slice(i, close + 1);
      out.push({ tag: tagText, hasNonce: /\bnonce=/i.test(tagText) });
      if (!isEnd && !/\/\s*>$/.test(tagText)) inRaw = true;
      i = close + 1;
      continue;
    }
    const close = html.indexOf(">", i);
    if (close === -1) break;
    i = close + 1;
  }
  return out;
}

/** 未带 nonce 的真实内联标签数 */
function tagsMissingNonce(html: string): number {
  return realTags(html).filter((t) => !t.hasNonce).length;
}

/** 带 nonce 的真实内联标签数 */
function nonceTagCount(html: string): number {
  return realTags(html).filter((t) => t.hasNonce).length;
}

describe("cspNonceAttr", () => {
  it("有 nonce → 输出 nonce 属性", () => {
    expect(cspNonceAttr(NONCE)).toBe(` nonce="${NONCE}"`);
  });

  it("未传 / 空串 / 纯空白 → 不输出属性（向后兼容）", () => {
    expect(cspNonceAttr(undefined)).toBe("");
    expect(cspNonceAttr(null)).toBe("");
    expect(cspNonceAttr("")).toBe("");
    expect(cspNonceAttr("   ")).toBe("");
  });

  it("nonce 被转义：一旦改成从 Request 读取，这就是注入点", () => {
    // nonce 本应由服务端生成，但若某天改为从上游反向代理透传，
    // 未转义的引号就能闭合属性并注入事件处理器。
    const evil = 'a" onload="alert(1)';
    const attr = cspNonceAttr(evil);
    expect(attr).not.toContain('onload="alert');
    expect(attr).toContain("&quot;");
  });

  it("尖括号与 & 被转义", () => {
    const attr = cspNonceAttr('<b>&"x"');
    expect(attr).not.toContain("<");
    expect(attr).not.toContain(">");
    expect(attr).toContain("&amp;");
  });
});

describe("applyCspNonce", () => {
  it("给所有 script / style 补 nonce", () => {
    const html = '<html><head><style>a{}</style></head><body><script>1</script><script>2</script></body></html>';
    const out = applyCspNonce(html, NONCE);
    expect(nonceTagCount(out)).toBe(3);
    expect(tagsMissingNonce(out)).toBe(0);
  });

  it("无 nonce 时原样返回（逐字节相同）", () => {
    const html = '<script>1</script><style>a{}</style>';
    expect(applyCspNonce(html, undefined)).toBe(html);
    expect(applyCspNonce(html, "")).toBe(html);
  });

  it("幂等：已带 nonce 的标签不重复添加", () => {
    const once = applyCspNonce('<script>1</script>', NONCE);
    const twice = applyCspNonce(once, NONCE);
    expect(twice).toBe(once);
    expect((twice.match(/nonce=/g) ?? []).length).toBe(1);
  });

  it("脚本里的 `</script>` 字面量按 HTML 规范确实闭合标签（与浏览器一致）", () => {
    // 这条看似"不修"，其实是**必须**如此：HTML 解析器的 script data 状态
    // 遇到 `</script` 就结束元素，与 JS 语义无关。因此浏览器也只会执行
    // 第一个 `</script>` 之前的内容。
    //
    // 换句话说：想在脚本里写字面量 `"</script>"` 本来就必须转义 ——
    // 这正是本模块 `safeJsonForScript` 存在的理由（它把 `<` 写成 `<`）。
    // 本函数的职责是"与浏览器解析一致地补 nonce"，而不是比浏览器更聪明。
    const html = `<script>var s = "<script>not a tag</script>";</script>`;
    const out = applyCspNonce(html, NONCE);
    expect(out).toContain(`<script nonce="${NONCE}">`);
    // 第二段（浏览器认的"新标签"）也带上 nonce
    expect(out).toContain(`</script nonce="${NONCE}">`);
  });

  it("脚本里的字面量经 safeJsonForScript 转义后，nonce 不会被塞进 JS 源码", () => {
    // 前后两半的对照：转义是调用方的责任，本函数只需不破坏结果。
    const payload = '</script><script>alert(1)</script>';
    const safe = safeJsonForScript(payload);
    const out = applyCspNonce(`<script>var B = ${safe};</script>`, NONCE);
    expect(out).toContain(`<script nonce="${NONCE}">var B = ${safe};</script>`);
    // nonce 只在标签上，脚本正文里没有
    const body = out.slice(out.indexOf(">") + 1, out.lastIndexOf("</script>"));
    expect(body).not.toContain("nonce");
  });

  it("脚本注释里的 `<script>` 文本不影响后续真实标签被补 nonce", () => {
    // 真实页面里 `/** ... 是 <script> 顶层 function 声明 ... */` 这类注释
    // 会让正则误判，把 nonce 补到注释文本上，后续真实标签反而漏掉。
    const html = [
      "<script>",
      "/** 声明是 <script> 顶层 function */",
      "function a() {}",
      "</script>",
      "<script>b()</script>",
    ].join("\\n");
    const out = applyCspNonce(html, NONCE);
    expect(out).toContain("/** 声明是 <script> 顶层 function */");
    expect(out).toContain(`<script nonce="${NONCE}">b()</script>`);
    expect((out.match(/nonce=/g) ?? []).length).toBe(2);
  });

  it("style 内容里的 `</` 不会提前退出内容区", () => {
    const html = "<style>a{content:'</div>'}</style><script>x()</script>";
    const out = applyCspNonce(html, NONCE);
    expect(out).toContain(`content:'</div>'`);
    expect(out).toContain(`<script nonce="${NONCE}">x()</script>`);
  });

  it("标签未闭合时原样保留剩余内容，不做猜测", () => {
    // 猜测会把 nonce 补到不该补的位置，而截断本身说明模板有问题
    const broken = "<script>never closed";
    expect(applyCspNonce(broken, NONCE)).toContain("never closed");
    expect(() => applyCspNonce("<style", NONCE)).not.toThrow();
  });

  it("空串与无标签输入不抛错", () => {
    expect(() => applyCspNonce("", NONCE)).not.toThrow();
    expect(applyCspNonce("", NONCE)).toBe("");
  });

  it("自闭合与带属性的标签同样被补", () => {
    const html = '<script type="module" src="/x.js"></script><style media="print">a{}</style>';
    const out = applyCspNonce(html, NONCE);
    expect(out).toContain(`<script nonce="${NONCE}" type="module"`);
    expect(out).toContain(`<style nonce="${NONCE}" media="print"`);
  });

  it("大写标签名同样处理", () => {
    const out = applyCspNonce('<SCRIPT>1</SCRIPT><STYLE>a{}</STYLE>', NONCE);
    expect(nonceTagCount(out)).toBe(2);
  });

  it("没有内联标签时也安全", () => {
    expect(() => applyCspNonce("<html></html>", NONCE)).not.toThrow();
  });
});

describe("renderAuthPage：全部视图都带 nonce", () => {
  const VIEWS = [
    "setup",
    "login",
    "invite",
    "recovery",
    "sso-error",
    "consent",
  ] as const;

  for (const view of VIEWS) {
    it(`${view}：所有内联标签都带 nonce`, () => {
      const html = renderAuthPage({ view, serviceName: "Svc", cspNonce: NONCE });
      expect(tagsMissingNonce(html), `${view} 有未带 nonce 的内联标签`).toBe(0);
      expect(nonceTagCount(html), `${view} 应至少有一个内联标签`).toBeGreaterThan(0);
    });

    it(`${view}：不传 nonce 时输出与之前完全一致`, () => {
      const withNonceRendered = renderAuthPage({ view, serviceName: "Svc", cspNonce: NONCE });
      const without = renderAuthPage({ view, serviceName: "Svc" });
      // 去掉 nonce 属性后两者应完全相同 —— 证明 nonce 是纯附加，不改内容
      const stripped = withNonceRendered.replace(new RegExp(` nonce="${NONCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "g"), "");
      expect(stripped).toBe(without);
      expect(without).not.toContain("nonce=");
    });
  }
});

describe("classic 主题直接渲染器", () => {
  it("renderSetupHtml 走 renderAuthPage 时带 nonce", () => {
    const html = renderAuthPage({ view: "setup", serviceName: "S", cspNonce: NONCE });
    expect(tagsMissingNonce(html)).toBe(0);
  });

  it("直接调用 renderSetupHtml 不受影响（向后兼容：该函数自身不加 nonce）", () => {
    // 直接调用单视图渲染器时没有 nonce 上下文 —— 它只接受视图级 options。
    // 这是刻意保留的：nonce 由 renderAuthPage（持有完整 contract）统一施加。
    expect(() => renderSetupHtml({ serviceName: "S" })).not.toThrow();
    expect(() => renderLoginHtml({ serviceName: "S" })).not.toThrow();
  });
});

describe("modern 主题：每个渲染器都带 nonce", () => {
  const RENDERERS = [
    ["setup", renderModernSetupHtml],
    ["login", renderModernLoginHtml],
    ["invite", renderModernInviteHtml],
    ["recovery", renderModernRecoveryHtml],
    ["consent", renderModernConsentHtml],
    ["sso-error", renderModernSsoErrorHtml],
  ] as const;

  for (const [name, fn] of RENDERERS) {
    it(`${name}：所有内联标签都带 nonce`, () => {
      const html = fn({ serviceName: "S", cspNonce: NONCE } as never);
      expect(tagsMissingNonce(html), `${name} 有未带 nonce 的内联标签`).toBe(0);
      expect(nonceTagCount(html)).toBeGreaterThan(0);
    });

    it(`${name}：不传 nonce 时输出与传 nonce 去掉属性后一致`, () => {
      const withN = fn({ serviceName: "S", cspNonce: NONCE } as never);
      const without = fn({ serviceName: "S" } as never);
      const esc = NONCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(withN.replace(new RegExp(` nonce="${esc}"`, "g"), "")).toBe(without);
      expect(without).not.toContain("nonce=");
    });
  }
});

describe("严格 CSP 场景的端到端一致性", () => {
  it("nonce 值在 HTML 中可被 CSP 头匹配（同一字符串）", () => {
    // 页面里的 nonce 必须与响应头里的完全一致，否则浏览器照样拦。
    const html = renderAuthPage({ view: "login", serviceName: "S", cspNonce: NONCE });
    expect(html).toContain(`nonce="${NONCE}"`);
    const csp = `script-src 'nonce-${NONCE}'; style-src 'nonce-${NONCE}'`;
    const fromHtml = /nonce="([^"]+)"/.exec(html)![1]!;
    expect(csp).toContain(`'nonce-${fromHtml}'`);
  });

  it("含 <script> 的认证页在有 nonce 时标签数 > 0（否则这条断言无意义）", () => {
    const html = renderAuthPage({ view: "login", serviceName: "S", cspNonce: NONCE });
    expect((html.match(/<script\b/gi) ?? []).length).toBeGreaterThan(0);
  });

  it("nonce 不会泄漏进 JS 变量（它是 HTML 属性，不是数据）", () => {
    const html = renderAuthPage({ view: "login", serviceName: "S", cspNonce: NONCE });
    // nonce 只应出现在标签属性里
    const occurrences = (html.match(new RegExp(NONCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
    const inAttrs = (html.match(new RegExp(`nonce="${NONCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "g")) ?? []).length;
    expect(occurrences).toBe(inAttrs);
  });
});
