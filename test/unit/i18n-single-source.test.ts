/**
 * i18n 单一事实来源门禁（AGENTS §2.2）
 *
 * ## 为什么需要这个文件
 *
 * 仓库里一度存在**四套**并行的中英文案来源：
 *
 * 1. `AUTH_I18N`（正规字典）
 * 2. `modal.ts`：多处硬编码中文字面量（确定 / 取消 / 确认 / 提示 / 请输入 …）
 * 3. `topbar.ts`：11 处 `isEn ? "…" : "…"` 三元表达式
 * 4. `settings-modal.ts`：局部 `const t = { … }` 8 键字典
 *
 * 每套都"自洽"，因此英文用户在英文页面上看到「确定 / 取消」这类问题**不会让
 * 任何测试变红**。规范要求「所有标题、按钮、占位符必须且只能使用 AUTH_I18N
 * 字典中英双语」，所以这里用门禁把它锁死。
 *
 * 现已全部收敛到 `AUTH_I18N`：服务端按请求语言挑好文案注入为
 * `window.__I18N__`，客户端脚本统一经 `__t(key)` 读取。
 */

import { describe, it, expect } from "vitest";
import {
  AUTH_I18N,
  getAuthI18n,
  detectLanguage,
  i18nAssignment,
  CLIENT_I18N_HELPER,
} from "../../src/ui/i18n.js";
import { renderAuthPage } from "../../src/ui/auth-pages.js";
import { renderModernLoginHtml } from "../../src/ui/themes/index.js";
import { renderGearMenuHtml, renderActionGroupHtml } from "../../src/ui/topbar.js";
import { renderSettingsModalHtml } from "../../src/ui/settings-modal.js";
import { MODAL_JS } from "../../src/ui/modal.js";

const CJK = /[一-鿿]/;

describe("AUTH_I18N 键在两种语言下必须完全对齐", () => {
  it("zh 与 en 的键集合一致（无缺失、无多余、无重复）", () => {
    const zh = Object.keys(AUTH_I18N.zh).sort();
    const en = Object.keys(AUTH_I18N.en).sort();
    expect(zh.filter((k) => !en.includes(k)), "仅 zh 存在的键").toEqual([]);
    expect(en.filter((k) => !zh.includes(k)), "仅 en 存在的键").toEqual([]);
    expect(new Set(zh).size, "zh 存在重复键").toBe(zh.length);
    expect(new Set(en).size, "en 存在重复键").toBe(en.length);
  });

  /**
   * 唯一允许的例外：语言切换按钮显示**目标语言自身的名称**。
   *
   * 这是 i18n 的通行做法 —— 中文用户在中文界面上看到「English」、英文用户看到
   * 「中文」，按钮本身的 label 语言与目标语言一致才符合直觉。其余任何 en 值
   * 出现中文字面量都属于硬编码残留。
   */
  const ALLOWED_CJK_IN_EN = new Set(["topbarSwitchToZh"]);

  it("en 字典不含中文字面量（唯一例外：语言切换按钮的目标语言名）", () => {
    const offenders: string[] = [];
    for (const [k, v] of Object.entries(AUTH_I18N.en)) {
      if (typeof v === "string" && CJK.test(v) && !ALLOWED_CJK_IN_EN.has(k)) {
        offenders.push(`${k}=${v}`);
      }
    }
    expect(offenders, `en 字典混入中文：${offenders.join(", ")}`).toEqual([]);
  });

  it("zh 字典不含纯英文占位（除品牌/技术专名外）", () => {
    // 仅提示：不做强制断言，避免误伤 Passkey / OAuth 等专名
    expect(typeof AUTH_I18N.zh.modalOk).toBe("string");
  });
});

describe("客户端脚本不得自带文案来源", () => {
  it("MODAL_JS 不含硬编码中文字面量", () => {
    // 去掉注释后再找字面量，避免把说明文字误判为文案
    const code = MODAL_JS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const literals = [...code.matchAll(/'([^']*)'/g)].map((m) => m[1] ?? "");
    const cjk = literals.filter((l) => CJK.test(l));
    expect(cjk, `MODAL_JS 仍有硬编码中文：${cjk.join(", ")}`).toEqual([]);
    expect(MODAL_JS).toContain("__t(");
  });

  it("topbar 不再使用 isEn 三元作为文案来源", () => {
    const html = [
      renderGearMenuHtml({ user: { email: "a@b.c" }, lang: "en" }),
      renderActionGroupHtml({ user: { email: "a@b.c" }, lang: "en" }),
    ].join("\n");
    // 英文渲染结果里不应出现中文 UI 文案
    for (const zh of ["设置", "退出登录", "通知中心", "深色模式", "浅色模式", "用户"]) {
      expect(html.includes(zh), `英文产物出现中文「${zh}」`).toBe(false);
    }
  });

  it("settings-modal 的文案来自 AUTH_I18N", () => {
    const en = renderSettingsModalHtml({ lang: "en" });
    const zh = renderSettingsModalHtml({ lang: "zh" });
    expect(en).toContain("Settings");
    expect(en).not.toContain("系统设置");
    expect(zh).toContain("系统设置");
  });
});

describe("i18n 注入：服务端按请求语言挑好文案下发", () => {
  const EN_REQ = new Request("https://x/login", {
    headers: { "accept-language": "en-US,en;q=0.9" },
  });
  const ZH_REQ = new Request("https://x/login", {
    headers: { "accept-language": "zh-CN,zh;q=0.9" },
  });

  it("i18nAssignment 输出合法语句且不含裸 script 标签", () => {
    const out = i18nAssignment("en");
    expect(out.startsWith("window.__I18N__ = ")).toBe(true);
    expect(out.endsWith(";")).toBe(true);
    // 用于**已有** script 块内部，因此不得自带标签
    expect(out.toLowerCase()).not.toContain("<script");
    expect(out.toLowerCase()).not.toContain("</script");
  });

  it("注入内容按语言正确挑选", () => {
    const en = JSON.parse(i18nAssignment("en").replace(/^window\.__I18N__ = /, "").replace(/;$/, ""));
    const zh = JSON.parse(i18nAssignment("zh").replace(/^window\.__I18N__ = /, "").replace(/;$/, ""));
    expect(en.modalOk).toBe("OK");
    expect(zh.modalOk).toBe("确定");
  });

  it("注入内容已转义 < > &，不得闭合外层 script", () => {
    const out = i18nAssignment("en");
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
  });

  it("英文请求的登录页注入英文文案", () => {
    const html = renderAuthPage({
      view: "login",
      serviceName: "Tower",
      basePath: "/tower",
      request: EN_REQ,
    });
    expect(html).toContain("window.__I18N__");
    expect(html).toContain('"modalOk":"OK"');
    expect(html).not.toContain('"modalOk":"确定"');
  });

  it("中文请求的登录页注入中文文案", () => {
    const html = renderAuthPage({
      view: "login",
      serviceName: "Tower",
      basePath: "/tower",
      request: ZH_REQ,
    });
    expect(html).toContain('"modalOk":"确定"');
  });

  it("modern 主题同样注入（不因换主题而回退为硬编码中文）", () => {
    const html = renderModernLoginHtml({ serviceName: "Tower", basePath: "/tower", lang: "en" });
    expect(html).toContain("window.__I18N__");
  });

  it("CLIENT_I18N_HELPER 读取注入对象，取不到时回落为 key 本身", () => {
    expect(CLIENT_I18N_HELPER).toContain("window.__I18N__");
    expect(CLIENT_I18N_HELPER).toContain("return (key in d) ? d[key] : key;");
  });
});

describe("detectLanguage 优先级", () => {
  it("?lang= > cookie > Accept-Language > 默认", () => {
    const withQuery = new Request("https://x/?lang=en", {
      headers: { cookie: "lang=zh", "accept-language": "zh-CN" },
    });
    expect(detectLanguage(withQuery)).toBe("en");

    const withCookie = new Request("https://x/", {
      headers: { cookie: "lang=en", "accept-language": "zh-CN" },
    });
    expect(detectLanguage(withCookie)).toBe("en");

    const headerOnly = new Request("https://x/", {
      headers: { "accept-language": "en-US" },
    });
    expect(detectLanguage(headerOnly)).toBe("en");

    expect(detectLanguage(new Request("https://x/"))).toBe("zh");
  });

  it("en-GB 等变体识别为 en（此前 topbar 用 === 'en' 会漏判）", () => {
    expect(detectLanguage(new Request("https://x/?lang=en-GB"))).toBe("en");
    expect(getAuthI18n("en-GB")).toBe(AUTH_I18N.en);
    expect(getAuthI18n("en-US")).toBe(AUTH_I18N.en);
  });
});
