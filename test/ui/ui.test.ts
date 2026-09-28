import { describe, it, expect } from "vitest";
import { renderAuthPage } from "../../src/ui/auth-pages";
import { renderModernLoginHtml, renderModernSetupHtml } from "../../src/ui/themes/index.js";
import {
  ICONS,
  getIcon,
  GlobeIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
  LogOutIcon,
  SettingsIcon,
  ShieldIcon,
  DatabaseIcon,
  SlidersIcon,
  InfoIcon,
} from "../../src/ui/icons";
import { detectLanguage, DEFAULT_LANG } from "../../src/ui/i18n";
import { DESIGN_TOKENS } from "../../src/ui/styles";
import { renderActionGroupHtml, renderGearMenuHtml, clientThemeAndLangScript } from "../../src/ui/topbar";
import { renderSettingsModalHtml } from "../../src/ui/settings-modal";

describe("@nuln/worker-kit/ui/icons", () => {
  it("标准图标符合 24x24 无填充 currentColor 规范", () => {
    for (const icon of [GlobeIcon, SunIcon, MoonIcon, MonitorIcon, LogOutIcon, SettingsIcon, ShieldIcon, DatabaseIcon, SlidersIcon, InfoIcon]) {
      expect(icon).toContain('viewBox="0 0 24 24"');
      expect(icon).toContain('fill="none"');
      expect(icon).toContain('stroke="currentColor"');
      expect(icon).toContain('stroke-width="2"');
    }
  });

  it("ICONS 字典包含标准图标 + getIcon 回退", () => {
    expect(ICONS.globe).toBe(GlobeIcon);
    expect(ICONS.settings).toBe(SettingsIcon);
    expect(getIcon("globe")).toBe(GlobeIcon);
    expect(getIcon("nope")).toBe("");
  });

  it("图标不含 Emoji", () => {
    for (const v of Object.values(ICONS)) {
      expect(/[\u{1F300}-\u{1FAFF}]/u.test(v)).toBe(false);
    }
  });
});

describe("@nuln/worker-kit/ui/topbar + settings-modal", () => {
  it("renderActionGroupHtml 生成标准顶栏操作区（语言 -> 主题 -> 用户 -> 设置 -> 退出）", () => {
    const html = renderActionGroupHtml({
      lang: "zh",
      user: { name: "Admin", role: "SuperAdmin" },
      showSettings: true,
      showLogout: true,
    });
    expect(html).toContain("lang-toggle-btn");
    expect(html).toContain("theme-toggle-btn");
    expect(html).toContain("user-chip");
    expect(html).toContain("settings-btn");
    expect(html).toContain("logout-btn");
  });

  it("renderSettingsModalHtml 生成包含 5 大标准分类的设置面板", () => {
    const html = renderSettingsModalHtml({
      lang: "zh",
      serviceName: "TestService",
      version: "1.0.0",
    });
    expect(html).toContain("常规与外观");
    expect(html).toContain("认证与安全");
    expect(html).toContain("存储与备份");
    expect(html).toContain("插件与扩展");
    expect(html).toContain("关于与系统");
  });

  it("clientThemeAndLangScript 包含三态主题与跟随系统监听", () => {
    const script = clientThemeAndLangScript("zh");
    expect(script).toContain("window.toggleTheme");
    expect(script).toContain("prefers-color-scheme");
  });
});

describe("@nuln/worker-kit/ui/i18n+styles", () => {
  it("detectLanguage: query > cookie > accept-language", () => {
    expect(DEFAULT_LANG).toBe("zh");
    expect(
      detectLanguage(new Request("https://x.test/?lang=en")),
    ).toBe("en");
    expect(
      detectLanguage(
        new Request("https://x.test/", { headers: { cookie: "lang=en" } }),
      ),
    ).toBe("en");
  });

  it("DESIGN_TOKENS: 灰白极简炭黑体系（非高饱和蓝）", () => {
    expect(DESIGN_TOKENS).toContain("--bg-canvas: #f8f9fa");
    expect(DESIGN_TOKENS).toContain("--border-base: #e2e5e9");
    expect(DESIGN_TOKENS).not.toContain("#2563eb");
  });
});

describe("@nuln/worker-kit/ui/auth", () => {
  it("renderPasskeyClientScript: 生成 Passkey 前端辅助脚本", async () => {
    const { renderPasskeyClientScript } = await import("../../src/ui/auth.js");
    const script = renderPasskeyClientScript("/oidc");
    expect(script).toContain("b64urlToBuf");
    expect(script).toContain("bufToB64url");
    expect(script).toContain("startPasskeyLogin");
    expect(script).toContain("/oidc/api/auth/webauthn/login/options");
  });

  it("renderAuthContainer & renderConfirmCard: 渲染认证模版与确认卡片", async () => {
    const { renderAuthContainer, renderConfirmCard } = await import("../../src/ui/auth.js");
    const c1 = renderAuthContainer({
      title: "用户登录",
      brandName: "OIDC",
      bodyHtml: "<p>表单内容</p>",
    });
    expect(c1).toContain("用户登录");
    expect(c1).toContain("OIDC");
    expect(c1).toContain("表单内容");

    const c2 = renderConfirmCard({
      title: "确认免密登录",
      message: "确认以 test@nuln.dev 登录当前会话？",
      actionUrl: "/api/auth/verify",
      buttonText: "确认登录",
      csrfToken: "mock-csrf-token",
    });
    expect(c2).toContain("确认免密登录");
    expect(c2).toContain("mock-csrf-token");
    expect(c2).toContain("确认登录");
  });

  it("renderSetupHtml / renderLoginHtml / renderInviteHtml / renderRecoveryHtml", async () => {
    const { renderSetupHtml, renderLoginHtml, renderInviteHtml, renderRecoveryHtml } = await import("../../src/ui/auth-pages.js");
    const setup = renderSetupHtml({ serviceName: "Tower", basePath: "/tower" });
    expect(setup).toContain("<title>Tower</title>");
    expect(setup).toContain("初始化");

    const login = renderLoginHtml({ serviceName: "Tower", basePath: "/tower", oidcEnabled: true });
    expect(login).toContain("<title>Tower</title>");
    expect(login).toContain("Passkey");
    expect(login).toContain("OIDC 单点登录");

    const invite = renderInviteHtml({ serviceName: "Mail", basePath: "/mail", inviteCode: "INV-123" });
    expect(invite).toContain("<title>Mail</title>");
    expect(invite).toContain("受邀注册");
    expect(invite).toContain("INV-123");

    const recovery = renderRecoveryHtml({ serviceName: "Flash", basePath: "/flash" });
    expect(recovery).toContain("<title>Flash</title>");
    expect(recovery).toContain("找回账号凭据");

    const { renderAuthPage } = await import("../../src/ui/auth-pages.js");
    const aLogin = renderAuthPage({ view: "login", serviceName: "Tower", basePath: "/tower", options: { oidcEnabled: true } });
    expect(aLogin).toContain("Passkey");
    const aSetup = renderAuthPage({ view: "setup", serviceName: "Tower", basePath: "/tower" });
    expect(aSetup).toContain("初始化");
    const aInvite = renderAuthPage({ view: "invite", serviceName: "Tower", basePath: "/tower", options: { inviteCode: "INV-1" } });
    expect(aInvite).toContain("受邀注册");
    const aRecov = renderAuthPage({ view: "recovery", serviceName: "Tower", basePath: "/tower" });
    expect(aRecov).toContain("找回账号凭据");

    // Local dev setup autofill
    const localReq = new Request("http://localhost:8788/tower/setup");
    const aSetupLocal = renderAuthPage({ view: "setup", serviceName: "Tower", basePath: "/tower", request: localReq });
    expect(aSetupLocal).toContain('value="admin@nuln.net"');
    expect(aSetupLocal).toContain('value="admin"');
    expect(aSetupLocal).toContain('value="Passkey"');

    // Production setup must NOT autofill test credentials
    const prodReq = new Request("https://tower.nuln.dev/setup");
    const aSetupProd = renderAuthPage({ view: "setup", serviceName: "Tower", basePath: "/tower", request: prodReq });
    expect(aSetupProd).toContain('value="" autocomplete="email"');
    expect(aSetupProd).toContain('value="" autocomplete="name"');
    expect(aSetupProd).not.toContain('value="admin@nuln.net"');
  });
});



/**
 * 零内联事件门禁（AGENTS §14.3 / §18.1）。
 *
 * 历史故障 T-01：把函数名直接写进 HTML 内联事件属性，在部分作用域下函数并未挂到
 * window，导致点击即抛 `ReferenceError` 白屏。因此渲染产物中**不允许出现任何
 * `on*=` 内联事件属性**，交互一律走 `data-action` + 事件委托。
 *
 * 该门禁此前只覆盖部分渲染器，导致 topbar / settings-modal / modern 主题的
 * 内联事件长期无人拦截。现同时覆盖 classic 与 modern 两条路径的全部认证页。
 */
describe("零内联事件门禁：渲染产物不得含 on*= 属性", () => {
  const INLINE_HANDLER = /\son[a-z]+\s*=\s*["']/i;

  const cases: Array<[string, () => string]> = [
    [
      "classic/login",
      () => renderAuthPage({ view: "login", serviceName: "Tower", basePath: "/tower" }),
    ],
    [
      "classic/setup",
      () => renderAuthPage({ view: "setup", serviceName: "Tower", basePath: "/tower" }),
    ],
    [
      "classic/invite",
      () => renderAuthPage({ view: "invite", serviceName: "Tower", basePath: "/tower" }),
    ],
    [
      "classic/recovery",
      () => renderAuthPage({ view: "recovery", serviceName: "Tower", basePath: "/tower" }),
    ],
    [
      "modern/login",
      () =>
        renderModernLoginHtml({ serviceName: "Tower", basePath: "/tower" }),
    ],
    [
      "modern/setup",
      () =>
        renderModernSetupHtml({ serviceName: "Tower", basePath: "/tower" }),
    ],
  ];

  it.each(cases)("%s 不得含内联事件属性", (label, render) => {
    const html = render();
    const offending = html
      .split("\n")
      .filter((line) => INLINE_HANDLER.test(line))
      .map((line) => line.trim().slice(0, 120));
    expect(offending, `${label} 存在内联事件：\n${offending.join("\n")}`).toEqual([]);
  });

  it.each([
    [
      "topbar/gear-menu",
      () => renderGearMenuHtml({ user: { email: "a@b.c" }, lang: "en" }),
    ],
    [
      "topbar/action-group",
      () => renderActionGroupHtml({ user: { email: "a@b.c" }, lang: "en" }),
    ],
    ["settings-modal", () => renderSettingsModalHtml({ lang: "en" })],
  ])("%s 不得含内联事件属性（该模块曾长期在门禁盲区）", (label, render) => {
    const html = render();
    const offending = html
      .split("\n")
      .filter((line) => INLINE_HANDLER.test(line))
      .map((line) => line.trim().slice(0, 120));
    expect(offending, `${label} 存在内联事件：\n${offending.join("\n")}`).toEqual([]);
  });

  it("settings-modal 不再声明全局 closeModal（曾与 modal.ts 冲突打瘫所有弹窗）", () => {
    const html = renderSettingsModalHtml({ lang: "en" });
    // 顶层 function closeModal(...) 会创建 window.closeModal，覆盖 modal.ts 的实现
    expect(html).not.toMatch(/^\s*function closeModal\s*\(/m);
    // 必须包在 IIFE 里
    expect(html).toContain("(function() {");
  });

  it("topbar 的跳转改为 data-nav（URL 而非 JS 表达式）", () => {
    const html = renderGearMenuHtml({ user: { email: "a@b.c" }, lang: "en" });
    expect(html).toContain("data-nav=");
    expect(html).not.toContain("location.href=");
  });

  it("交互按钮确实走 data-action（防止门禁退化为空断言）", () => {
    const html = renderAuthPage({ view: "login", serviceName: "Tower", basePath: "/tower" });
    expect(html, "登录页应存在 data-action 按钮").toMatch(/data-action=/);
    const modern = renderModernLoginHtml({ serviceName: "Tower", basePath: "/tower" });
    expect(modern, "modern 登录页应存在 data-action 按钮").toMatch(/data-action=/);
  });
});

/**
 * 页面标题规范门禁（AGENTS §2.2）
 *
 * 规定值：`font-size: 15px; font-weight: 600; margin: 0 0 14px 0; letter-spacing: -0.01em;`
 * 并**明文禁止** 18px / 20px 大号粗体。
 *
 * 之所以要设门禁：这条规范此前散落在 5 处内联样式中（3 处漏了
 * `letter-spacing`、下边距写成 4px/6px），另有 styles.ts 的
 * `h1 { 20px/700 }`、`.page-title { 19px/650 }`、modern 主题的
 * `.brand-title { 18px }` 直接违反。散落即失守，必须集中 + 断言。
 */
describe("页面标题规范（AGENTS §2.2）", () => {
  const FORBIDDEN_SIZES = [18, 19, 20];

  it("styles.ts 不得出现被禁止的标题字号", async () => {
    const styles = await import("../../src/ui/styles.js");
    const modern = await import("../../src/ui/themes/modern/styles.js");
    for (const [name, mod] of [
      ["styles", styles],
      ["themes/modern/styles", modern],
    ] as const) {
      const all = Object.values(mod)
        .filter((v): v is string => typeof v === "string")
        .join("\n");
      // 只检查标题类选择器上的字号，避免误伤图标 fallback 等非标题元素
      for (const selector of ["h1", ".page-title", ".brand-title"]) {
        const re = new RegExp(
          `${selector.replace(".", "\\.")}\\s*\\{[^}]*?font-size:\\s*(${FORBIDDEN_SIZES.join("|")})px`,
          "g",
        );
        const hits = all.match(re);
        expect(hits, `${name} 的 ${selector} 使用了被禁止的字号：${hits}`).toBeNull();
      }
    }
  });

  it("PAGE_TITLE_STYLE token 与 §2.2 规定值完全一致", async () => {
    const { PAGE_TITLE_STYLE } = await import("../../src/ui/styles.js");
    expect(PAGE_TITLE_STYLE).toContain("font-size:15px");
    expect(PAGE_TITLE_STYLE).toContain("font-weight:600");
    expect(PAGE_TITLE_STYLE).toContain("margin:0 0 14px 0");
    expect(PAGE_TITLE_STYLE).toContain("letter-spacing:-0.01em");
  });

  it("各认证页标题均使用该 token（不再各自手写内联样式）", () => {
    for (const [label, html] of [
      ["setup", renderAuthPage({ view: "setup", serviceName: "Tower", basePath: "/tower" })],
      [
        "invite",
        renderAuthPage({
          view: "invite",
          serviceName: "Tower",
          basePath: "/tower",
          options: { inviteCode: "abc" },
        } as any),
      ],
    ] as const) {
      expect(
        html.includes('style="font-size:15px;font-weight:600'),
        `${label} 页标题应使用 PAGE_TITLE_STYLE`,
      ).toBe(true);
      expect(
        html.includes('font-size:15px;font-weight:600;margin:0 0 4px'),
        `${label} 页标题下边距应为 14px（规范值），不应为 4px`,
      ).toBe(false);
    }
  });
});
