/**
 * @nuln/worker-kit/ui/script-safety
 *
 * XSS 回归测试：验证凡是把外部可控值插值进 `<script>` 的位置，都经过
 * `safeJsonForScript` / `sanitizeBasePrefix` 处理。
 *
 * 覆盖两条渲染路径（AGENTS 方案 A）：
 *   1. classic —— `auth-pages.ts` 的 `renderLoginHtml` / `renderSetupHtml`
 *   2. modern  —— `themes/modern/auth-pages.ts` 的 `renderModernLoginHtml` /
 *                 `renderModernSetupHtml`
 *
 * 两条路径是平行实现，任何一条漏改都会形成安全分叉，因此必须同时断言。
 */

import { describe, it, expect } from "vitest";
import {
  safeJsonForScript,
  sanitizeBasePrefix,
  renderLoginHtml,
  renderSetupHtml,
} from "../../src/ui/index.js";
import { renderModernLoginHtml, renderModernSetupHtml } from "../../src/ui/themes/index.js";

/** 可执行的注入载荷：若闭合成功，页面会出现第二个可执行 script 块。 */
const EVIL = `</script><script>window.__pwned=1</script>`;

/** 提取文档中所有 <script> 正文，用于逐段语法校验。 */
function scriptBlocks(html: string): string[] {
  return [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");
}

/** 断言：注入未生效，且每段脚本都能被独立解析（未被截断出语法错误）。 */
function expectNoBreakout(html: string, label: string): void {
  expect(html, `${label}: 不得出现被闭合出的第二个脚本块`).not.toContain(
    "<script>window.__pwned=1</script>",
  );
  expect(html, `${label}: 不得出现属性逃逸`).not.toContain('"><script');
  for (const code of scriptBlocks(html)) {
    expect(
      () => new Function(code),
      `${label}: 脚本段应可独立解析`,
    ).not.toThrow();
  }
}

describe("safeJsonForScript", () => {
  it("转义 < > & 与 U+2028/U+2029", () => {
    const out = safeJsonForScript(`<>&${" "}${" "}`);
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).not.toContain("&");
    expect(out).not.toContain(" ");
    expect(out).not.toContain(" ");
  });

  it("保持 JSON 语义等价（解析后仍等于原值）", () => {
    const raw = `a<b>&c"d'e\\f`;
    const parsed = JSON.parse(safeJsonForScript(raw)) as string;
    expect(parsed).toBe(raw);
  });

  it("对 </script> 载荷生效", () => {
    expect(safeJsonForScript(EVIL)).not.toContain("</script>");
  });
});

describe("sanitizeBasePrefix", () => {
  it("剔除引号/尖括号/&/反斜杠", () => {
    const out = sanitizeBasePrefix(`/b"><script>&'\\`);
    for (const ch of ['"', "'", "<", ">", "&", "\\"]) {
      expect(out, `不应残留 ${ch}`).not.toContain(ch);
    }
  });

  it("对空值返回空串", () => {
    expect(sanitizeBasePrefix("")).toBe("");
    expect(sanitizeBasePrefix(undefined)).toBe("");
    expect(sanitizeBasePrefix(null)).toBe("");
  });
});

describe("XSS 回归：basePath 含 </script> 时不得闭合脚本块", () => {
  const evilBase = `/bark">${EVIL}`;

  it("classic Passkey 登录页：WEBAUTHN_SCRIPT 曾是裸 JSON.stringify", () => {
    expectNoBreakout(
      renderLoginHtml({ serviceName: "Svc", basePath: evilBase, lang: "zh" }),
      "classic/login",
    );
  });

  it("classic Setup 页：不得因 basePath 注入", () => {
    expectNoBreakout(
      renderSetupHtml({ serviceName: "Svc", basePath: evilBase, lang: "zh" }),
      "classic/setup",
    );
  });

  it("modern Passkey 登录页：与 classic 同一防护", () => {
    expectNoBreakout(
      renderModernLoginHtml({ serviceName: "Svc", basePath: evilBase, lang: "zh" }),
      "modern/login",
    );
  });

  it("modern Setup 页：与 classic 同一防护", () => {
    expectNoBreakout(
      renderModernSetupHtml({ serviceName: "Svc", basePath: evilBase, lang: "zh" }),
      "modern/setup",
    );
  });

  // 只断言能真正逃逸 `href="…"` 的字符。
  // 单引号在双引号属性内无害（favicon 的 data:image/svg+xml URI 内部就含单引号），
  // 因此不在此列，避免把合法 data URI 误判为注入。
  const BREAKOUT_CHARS = ['"', "<", ">"] as const;

  it.each([
    ["classic", () => renderLoginHtml({ serviceName: "Svc", basePath: evilBase, lang: "zh" })],
    ["modern", () => renderModernLoginHtml({ serviceName: "Svc", basePath: evilBase, lang: "zh" })],
  ])("%s 属性上下文同样被清洗：href 不得携带逃逸字符", (label, render) => {
    const html = render();
    for (const m of html.matchAll(/href="([^"]*)"/g)) {
      const href = m[1] ?? "";
      for (const ch of BREAKOUT_CHARS) {
        expect(href, `${label} href 残留逃逸字符 ${ch}`).not.toContain(ch);
      }
    }
  });
});

describe("XSS 回归：defaultEmail 是调用方可控的公开 API", () => {
  it("classic Setup 页：defaultEmail 不得闭合脚本块", () => {
    expectNoBreakout(
      renderSetupHtml({ serviceName: "Svc", defaultEmail: EVIL, lang: "zh" }),
      "classic/setup#defaultEmail",
    );
  });

  it("modern Setup 页：defaultEmail 不得闭合脚本块", () => {
    expectNoBreakout(
      renderModernSetupHtml({ serviceName: "Svc", defaultEmail: EVIL, lang: "zh" }),
      "modern/setup#defaultEmail",
    );
  });
});

describe("正常前缀不受清洗影响（防过度处理）", () => {
  it("/bark、/ops/bark、/bark-v2 原样保留", () => {
    for (const base of ["/bark", "/ops/bark", "/bark-v2"]) {
      expect(sanitizeBasePrefix(base)).toBe(base);
      const classic = renderLoginHtml({ serviceName: "S", basePath: base, lang: "zh" });
      expect(classic).toContain(base);
      const modern = renderModernLoginHtml({ serviceName: "S", basePath: base, lang: "zh" });
      expect(modern).toContain(base);
    }
  });
});
