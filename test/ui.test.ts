import { describe, it, expect } from "vitest";
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
} from "../src/ui/icons";
import { detectLanguage, DEFAULT_LANG } from "../src/ui/i18n";
import { DESIGN_TOKENS } from "../src/ui/styles";
import { renderActionGroupHtml, clientThemeAndLangScript } from "../src/ui/topbar";
import { renderSettingsModalHtml } from "../src/ui/settings-modal";

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
    const { renderPasskeyClientScript } = await import("../src/ui/auth.js");
    const script = renderPasskeyClientScript("/oidc");
    expect(script).toContain("b64urlToBuf");
    expect(script).toContain("bufToB64url");
    expect(script).toContain("startPasskeyLogin");
    expect(script).toContain("/oidc/api/auth/webauthn/login/options");
  });

  it("renderAuthContainer & renderConfirmCard: 渲染认证模版与确认卡片", async () => {
    const { renderAuthContainer, renderConfirmCard } = await import("../src/ui/auth.js");
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
    const { renderSetupHtml, renderLoginHtml, renderInviteHtml, renderRecoveryHtml } = await import("../src/ui/auth-pages.js");
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
  });
});


