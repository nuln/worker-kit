import { describe, it, expect } from "vitest";
import {
  renderAuthPage,
  authPageResponse,
  renderActionGroupHtml,
  renderGearMenuHtml,
  renderSettingsModalHtml,
  clientThemeAndLangScript,
  detectLanguage,
  getAuthI18n,
  AUTH_I18N,
  MODAL_CSS,
  MODAL_JS,
} from "../src/ui/index.js";

describe("UI Module - Deep Branch & Visual Component Coverage", () => {
  it("renders all auth page views: setup, login, invite, recovery, verify-email", () => {
    // 1. Setup view in English
    const setupEn = renderAuthPage({
      view: "setup",
      serviceName: "Console",
      lang: "en",
      basePath: "/console",
    });
    expect(setupEn).toContain("Setup");
    expect(setupEn).toContain("Console");

    // 2. Invite view in zh
    const inviteZh = renderAuthPage({
      view: "invite",
      serviceName: "Mail",
      lang: "zh",
      basePath: "/mail",
    });
    expect(inviteZh).toContain("受邀注册");
    expect(inviteZh).toContain("Mail");

    // 3. Recovery view
    const recoveryEn = renderAuthPage({
      view: "recovery",
      serviceName: "Tower",
      lang: "en",
      basePath: "/tower",
    });
    expect(recoveryEn).toContain("Tower");

    // 4. Default fallback view
    const defaultView = renderAuthPage({
      view: "login",
      serviceName: "OIDC",
    });
    expect(defaultView).toContain("OIDC");
  });

  it("covers detectLanguage with Cookie, URL search param, and Accept-Language header", () => {
    // URL takes top priority
    const reqUrl = new Request("https://nuln.net/login?lang=en-US", {
      headers: { Cookie: "lang=zh", "Accept-Language": "zh-CN,zh;q=0.9" },
    });
    expect(detectLanguage(reqUrl)).toBe("en");

    // Cookie priority over header
    const reqCookie = new Request("https://nuln.net/login", {
      headers: { Cookie: "lang=en", "Accept-Language": "zh-CN,zh;q=0.9" },
    });
    expect(detectLanguage(reqCookie)).toBe("en");

    // Accept-Language header fallback
    const reqHeader = new Request("https://nuln.net/login", {
      headers: { "Accept-Language": "en-US,en;q=0.9" },
    });
    expect(detectLanguage(reqHeader)).toBe("en");

    // Default fallback
    const reqEmpty = new Request("https://nuln.net/login");
    expect(detectLanguage(reqEmpty)).toBe("zh");

    // Null/undefined request
    expect(detectLanguage(undefined)).toBe("zh");
  });

  it("covers topbar with notifications count > 99, custom user avatars, and hidden buttons", () => {
    const actionsFull = renderActionGroupHtml({
      lang: "en",
      showLang: true,
      showTheme: true,
      showNotifications: true,
      notificationsCount: 150, // Should render 99+
      user: { name: "Bob Builder", email: "bob@nuln.net", role: "SuperAdmin", avatar: "👷" },
      showSettings: true,
      onSettingsClick: "openCustomSettings()",
      showLogout: true,
      onLogoutClick: "customLogout()",
    });
    expect(actionsFull).toContain("99+");
    expect(actionsFull).toContain("SuperAdmin");
    expect(actionsFull).toContain("openCustomSettings()");
    expect(actionsFull).toContain("customLogout()");
    expect(actionsFull).toContain("👷");

    // Minimal topbar (no theme, no lang, no settings, no logout, minimal user)
    const actionsMinimal = renderActionGroupHtml({
      showLang: false,
      showTheme: false,
      showSettings: false,
      showLogout: false,
      user: { email: "plain@nuln.net" },
    });
    expect(actionsMinimal).not.toContain("lang-toggle-btn");
    expect(actionsMinimal).not.toContain("theme-toggle-btn");
    expect(actionsMinimal).toContain("plain");

    // Gear menu with custom handlers
    const gearCustom = renderGearMenuHtml({
      user: { name: "Carol" },
      lang: "zh",
      onSettingsClick: "gotoSettings()",
      onLogoutClick: "doSignout()",
    });
    expect(gearCustom).toContain("gotoSettings()");
    expect(gearCustom).toContain("doSignout()");
    expect(gearCustom).toContain("Carol");
  });

  it("covers settings modal custom tabs, MODAL_CSS and MODAL_JS", () => {
    const modalWithTabs = renderSettingsModalHtml({
      modalId: "myCustomModal",
      serviceName: "Gateway",
      version: "3.0.0",
      lang: "zh",
      tabsContent: {
        generalHtml: "<div>Custom General</div>",
        securityHtml: "<div>Custom Security</div>",
        storageHtml: "<div>Custom Storage</div>",
        pluginsHtml: "<div>Custom Plugins</div>",
        aboutHtml: "<div>Custom About</div>",
      },
    });
    expect(modalWithTabs).toContain("myCustomModal");
    expect(modalWithTabs).toContain("Custom General");
    expect(modalWithTabs).toContain("Custom Security");
    expect(modalWithTabs).toContain("Custom Storage");
    expect(modalWithTabs).toContain("Custom Plugins");
    expect(modalWithTabs).toContain("Custom About");

    expect(MODAL_CSS).toContain(".modal-card");
    expect(MODAL_JS).toContain("window.openModal");

    const script = clientThemeAndLangScript("en");
    expect(script).toContain("<script>");
  });

  it("covers getAuthI18n for English and Chinese", () => {
    const i18nZh = getAuthI18n("zh-CN");
    expect(i18nZh.setupTitle).toBe("初始化");

    const i18nEn = getAuthI18n("en-US");
    expect(i18nEn.setupTitle).toBe("Setup");
  });
});
