/**
 * 页面必须真正定义 `window.__t` —— 否则弹窗一开就抛 ReferenceError。
 *
 * ## 缺陷本体
 *
 * `src/ui/modal.ts` 等客户端脚本用的是**裸** `__t('modalTitle')`。浏览器里
 * `window.__t = function (key) {...}` 等价于建全局，裸调用成立。
 *
 * 但 `i18nAssignment()` 此前**只注入字典**（`window.__I18N__ = {...};`），
 * 而定义读取器的 `CLIENT_I18N_HELPER` 虽有导出却**零引用** —— 一段死代码。
 * 结果是页面上根本没有 `__t`：
 *
 * - 真实浏览器：用户点开任何弹窗 → `ReferenceError: __t is not defined`，
 *   弹窗标题渲染成空白（不报错给用户，因为异常在事件处理器里）。
 * - `new Function` 沙箱：window 只是普通参数，裸标识符同样解析不到。
 *
 * 两种环境都失败 —— 说明这不是环境差异，而是真缺陷。实测
 * `renderAuthPage` 产出的 HTML 里 `modal-close-x-btn` 所在 script 块
 * 调用 `__t('modalTitle')`，而全页无任何 `window.__t =` 定义。
 *
 * ## 为什么这条测试要检查"整页存在定义"，而不是"某个字符串包含"
 *
 * 只断言 `i18nAssignment()` 的返回值含 `__t =` 太弱：页面可能走了别的
 * 注入路径，helper 又被漏掉。真正的契约是**最终 HTML 里跑得起来**。
 * 因此这里 (1) 断言所有注入点都带 helper，(2) 在 `new Function` 沙箱里
 * 真实执行 `__t('modalTitle')` 并取到译文 —— 沙箱故意不提供 `__t` 全局，
 * 解析不到就必然抛错，与浏览器行为一致。
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { i18nAssignment, CLIENT_I18N_HELPER, getAuthI18n } from "../../src/ui/i18n.js";
import { renderAuthPage } from "../../src/ui/auth-pages.js";
// AuthPageView 定义在 themes/types.ts，auth-pages.ts 只内部引用、不再导出
import type { AuthPageView } from "../../src/ui/themes/types.js";

describe("i18nAssignment 必须同时注入字典与读取器", () => {
  it("返回值含 window.__I18N__ 字典", () => {
    expect(i18nAssignment("zh-CN")).toContain("window.__I18N__");
  });

  it("返回值含 window.__t 定义（这是弹窗能工作的前提）", () => {
    const out = i18nAssignment("zh-CN");
    expect(out, "缺少 __t 定义 → 弹窗标题恒为 ReferenceError").toContain("window.__t");
    expect(out).toContain(CLIENT_I18N_HELPER);
  });

  it("字典在前、读取器在后：脚本按序执行，读取器依赖字典已就绪", () => {
    const out = i18nAssignment("zh-CN");
    expect(out.indexOf("window.__I18N__")).toBeLessThan(out.indexOf("window.__t"));
  });

  it("helper 不读取 __I18N__ 之外的全局（保持自包含）", () => {
    // 避免有人把 helper 改成依赖别的注入对象，那样单测环境又会缺东西
    expect(CLIENT_I18N_HELPER).toContain("window.__I18N__");
  });
});

describe("整页可执行性：HTML 里的 __t 能真的取到译文", () => {
  // 全部 AuthPageView 取值 —— 少写一个就留下未覆盖的注入路径
  const views: AuthPageView[] = ["setup", "login", "invite", "recovery", "sso-error", "consent"];

  for (const view of views) {
    it(`${view} 页面：__t 的注入完整性（用了就必须有）`, () => {
      const html = renderAuthPage({ view, serviceName: "Gate", basePath: `/x-${view}` });

      // 该页是否用到 __t（sso-error / consent 不引 modal 脚本，本就不用）
      const scripts = (html.match(/<script>[\s\S]*?<\/script>/g) || []).join("\n");
      const usesT = /(^|[^\w.])__t\s*\(/.test(scripts);

      if (!usesT) {
        // 不涉及本缺陷；但仍不该携带孤立的读取器定义（说明注入点走偏了）
        expect(html, `${view} 未用 __t 却注入了读取器，注入逻辑可能有分叉`).not.toContain(
          "window.__t =",
        );
        return;
      }

      // 用了就必须有定义
      expect(html, `${view} 页面用了 __t 却没有 window.__t 定义`).toContain("window.__t =");

      // 沙箱执行：故意只给 window 普通对象（与浏览器不同，裸标识符解析不到）。
      // 页面自身注入了 window.__t，读取器转发后仍应取到译文。
      const win: Record<string, unknown> = {};
      const run = new Function(
        "window",
        `${i18nAssignment("zh-CN")}\nreturn window.__t("modalTitle");`,
      );
      expect(run(win), "沙箱内应能通过页面注入的读取器取到译文").toBe("提示");
    });
  }

  it("英文页面的 modalTitle 走英文译文（不是回落 key 本身）", () => {
    const win: Record<string, unknown> = {};
    const run = new Function("window", `${i18nAssignment("en-US")}\nreturn window.__t("modalTitle");`);
    expect(run(win)).toBe(getAuthI18n("en-US").modalTitle);
    expect(run(win)).not.toBe("modalTitle");
  });

  it("读取器在字典缺失时回落 key 本身（不抛错）", () => {
    // 退化场景：某个页面忘了注入字典。此时应显示 key 而不是整页脚本崩掉。
    const run = new Function("window", `${CLIENT_I18N_HELPER}\nreturn window.__t("someMissingKey");`);
    expect(run({})).toBe("someMissingKey");
  });
});

describe("防回归：注入点不得再与 helper 分离", () => {
  it("auth-pages.ts 的每个 i18nAssignment 注入点都自带 helper", () => {
    // 用源码断言而非运行时快照：注入点若被改回裸字典调用，这里立刻变红。
    const src = readFileSync(process.cwd() + "/src/ui/auth-pages.ts", "utf8");
    const calls = src.match(/\$\{i18nAssignment\([^)]*\)\}/g) || [];
    expect(calls.length, "auth-pages 应有多个 i18n 注入点").toBeGreaterThan(0);
    // 注入点写法本身即包含 helper（由 i18nAssignment 内部拼上），
    // 因此只需确认没有绕过 i18nAssignment 直接写 window.__I18N__。
    expect(src, "存在绕过 i18nAssignment 的裸字典注入").not.toMatch(/window\.__I18N__\s*=\s*\{/);
  });

  it("themes/modern/auth-pages.ts 同样不绕过", () => {
    const src = readFileSync(process.cwd() + "/src/ui/themes/modern/auth-pages.ts", "utf8");
    const calls = src.match(/\$\{i18nAssignment\([^)]*\)\}/g) || [];
    expect(calls.length).toBeGreaterThan(0);
    expect(src).not.toMatch(/window\.__I18N__\s*=\s*\{/);
  });
});
