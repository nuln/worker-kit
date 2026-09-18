import { describe, it, expect } from "vitest";
import {
  resolveUiTheme,
  renderAuthPage,
  authPageResponse,
  renderLoginHtml,
  renderSetupHtml,
  renderInviteHtml,
  renderRecoveryHtml,
  renderSsoErrorHtml,
  renderModernLoginHtml,
  renderModernSetupHtml,
  renderModernInviteHtml,
  renderModernRecoveryHtml,
  renderModernConsentHtml,
  renderModernSsoErrorHtml,
  MODERN_AUTH_STYLE,
  MODERN_DESIGN_TOKENS,
} from "../src/ui/index.js";

describe("Worker-Kit UI Themes (Classic & Modern)", () => {
  describe("resolveUiTheme", () => {
    it("returns explicit theme when provided", () => {
      expect(resolveUiTheme({ theme: "modern" })).toBe("modern");
      expect(resolveUiTheme({ theme: "classic" })).toBe("classic");
    });

    it("resolves theme from request query parameters (?ui_theme or ?theme)", () => {
      const req1 = new Request("https://auth.example.com/login?ui_theme=modern");
      expect(resolveUiTheme({ request: req1 })).toBe("modern");

      const req2 = new Request("https://auth.example.com/login?theme=modern");
      expect(resolveUiTheme({ request: req2 })).toBe("modern");

      const req3 = new Request("https://auth.example.com/login?theme=classic");
      expect(resolveUiTheme({ request: req3 })).toBe("classic");
    });

    it("resolves theme from request Cookie header", () => {
      const req1 = new Request("https://auth.example.com/login", {
        headers: { cookie: "session=xyz; ui_theme=modern; lang=zh-CN" },
      });
      expect(resolveUiTheme({ request: req1 })).toBe("modern");

      const req2 = new Request("https://auth.example.com/login", {
        headers: { cookie: "theme=modern" },
      });
      expect(resolveUiTheme({ request: req2 })).toBe("modern");

      const req3 = new Request("https://auth.example.com/login", {
        headers: { cookie: "ui_theme=classic" },
      });
      expect(resolveUiTheme({ request: req3 })).toBe("classic");
    });

    it("resolves theme from env.UI_THEME", () => {
      expect(resolveUiTheme({ env: { UI_THEME: "modern" } })).toBe("modern");
      expect(resolveUiTheme({ env: { UI_THEME: "classic" } })).toBe("classic");
    });

    it("defaults to classic when no theme is specified", () => {
      expect(resolveUiTheme()).toBe("classic");
      expect(resolveUiTheme({})).toBe("classic");
      expect(resolveUiTheme({ request: new Request("https://auth.example.com/login") })).toBe("classic");
    });
  });

  describe("Modern Design Tokens and Styles", () => {
    it("defines Zinc dark and light theme tokens and ambient mesh glow", () => {
      expect(MODERN_DESIGN_TOKENS).toContain("--bg-canvas-mesh");
      expect(MODERN_DESIGN_TOKENS).toContain("#09090b");
      expect(MODERN_DESIGN_TOKENS).toContain("#fafafa");
      expect(MODERN_AUTH_STYLE).toContain(".auth-layout");
      expect(MODERN_AUTH_STYLE).toContain(".modern-card");
      expect(MODERN_AUTH_STYLE).toContain("max-width: 380px");
      expect(MODERN_AUTH_STYLE).toContain("border-radius: 20px");
      expect(MODERN_AUTH_STYLE).toContain("backdrop-filter: blur");
    });
  });

  describe("Modern Login Page Rendering", () => {
    it("renders modern login page with Passkey CTA and branding", () => {
      const html = renderModernLoginHtml({
        serviceName: "Tower",
        basePath: "/tower",
        lang: "zh-CN",
        ssoProviders: [{ id: "oidc", name: "SSO Hub" }],
        enableRecovery: true,
      });

      expect(html).toContain("Tower");
      expect(html).toContain("modern-card");
      expect(html).toContain("btn-passkey");
      expect(html).toContain("SSO Hub");
      expect(html).toContain("/tower/recovery");
      expect(html).toContain("lang=\"zh-CN\"");
    });

    it("renders English modern login page", () => {
      const html = renderModernLoginHtml({
        serviceName: "OIDC Portal",
        basePath: "",
        lang: "en",
      });

      expect(html).toContain("lang=\"en\"");
      expect(html).toContain("Passkey");
      expect(html).toContain("OIDC Portal");
    });

    it("supports automatic theme dispatch via renderLoginHtml", () => {
      const classicHtml = renderLoginHtml({
        serviceName: "Mail",
        theme: "classic",
      });
      const modernHtml = renderLoginHtml({
        serviceName: "Mail",
        theme: "modern",
      });

      expect(classicHtml).not.toContain("modern-card");
      expect(modernHtml).toContain("modern-card");
    });
  });

  describe("Modern Setup Page Rendering", () => {
    it("renders modern setup page with hardware passkey registration", () => {
      const html = renderModernSetupHtml({
        serviceName: "Mail Admin",
        basePath: "/mail",
        name: "Admin",
        email: "admin@nuln.net",
      });

      expect(html).toContain("Mail Admin");
      expect(html).toContain("modern-card");
      expect(html).toContain("setup-btn");
      expect(html).toContain("admin@nuln.net");
    });

    it("respects dev setup auto-fill in local environment", () => {
      const devReq = new Request("http://127.0.0.1:8788/setup");
      const html = renderModernSetupHtml({
        serviceName: "Tower",
        request: devReq,
      });

      expect(html).toContain("admin@nuln.net");
    });
  });

  describe("Modern Invite and Recovery Pages", () => {
    it("renders modern invite page with code", () => {
      const html = renderModernInviteHtml({
        serviceName: "Haeo",
        inviteCode: "INVITE-999",
        prefillEmail: "user@example.com",
      });

      expect(html).toContain("INVITE-999");
      expect(html).toContain("user@example.com");
      expect(html).toContain("readonly");
      expect(html).toContain("modern-card");
    });

    it("renders modern recovery page", () => {
      const html = renderModernRecoveryHtml({
        serviceName: "Console",
        basePath: "/console",
      });

      expect(html).toContain("modern-card");
      expect(html).toContain("recovery-btn");
      expect(html).toContain("/console/login");
    });
  });

  describe("Modern Consent and SSO Error Pages", () => {
    it("renders modern consent authorization page", () => {
      const html = renderModernConsentHtml({
        serviceName: "Nuln Auth",
        clientId: "client_123",
        clientName: "Tower App",
        scopes: ["openid", "profile", "email"],
        redirectUri: "https://tower.nuln.net/callback",
        userEmail: "admin@nuln.net",
        userName: "Admin User",
        csrfToken: "csrf_token_abc",
      });

      expect(html).toContain("Tower App");
      expect(html).toContain("admin@nuln.net");
      expect(html).toContain("openid");
      expect(html).toContain("profile");
      expect(html).toContain("csrf_token_abc");
      expect(html).toContain("btn-passkey");
      expect(html).toContain("btn-outline");
    });

    it("renders modern SSO error page with retry and details", () => {
      const html = renderModernSsoErrorHtml({
        serviceName: "Pay Gateway",
        error: "access_denied",
        errorDescription: "User cancelled authorization request",
        retryUrl: "/pay/login/retry",
        loginUrl: "/pay/login",
      });

      expect(html).toContain("access_denied");
      expect(html).toContain("User cancelled authorization request");
      expect(html).toContain("/pay/login/retry");
      expect(html).toContain("/pay/login");
      expect(html).toContain("modern-card");
    });
  });

  describe("Unified authPageResponse & renderAuthPage Routing", () => {
    it("correctly renders each view with theme auto-selection", () => {
      const loginRes = authPageResponse({
        view: "login",
        serviceName: "Flash",
        theme: "modern",
      });
      expect(loginRes.status).toBe(200);
      expect(loginRes.headers.get("content-type")).toContain("text/html");

      const setupHtml = renderAuthPage({
        view: "setup",
        serviceName: "Flash",
        theme: "modern",
      });
      expect(setupHtml).toContain("modern-card");

      const inviteHtml = renderAuthPage({
        view: "invite",
        serviceName: "Flash",
        theme: "modern",
        options: { inviteCode: "ABC" },
      });
      expect(inviteHtml).toContain("ABC");

      const recoveryHtml = renderAuthPage({
        view: "recovery",
        serviceName: "Flash",
        theme: "modern",
      });
      expect(recoveryHtml).toContain("modern-card");

      const ssoErrHtml = renderAuthPage({
        view: "sso-error",
        serviceName: "Flash",
        theme: "modern",
        options: { error: "invalid_grant" },
      });
      expect(ssoErrHtml).toContain("invalid_grant");
    });
  });
});
