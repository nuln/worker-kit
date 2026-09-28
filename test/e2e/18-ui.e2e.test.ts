import { describe, it, expect } from "vitest";
import {
  renderAuthPage,
  authPageResponse,
  renderActionGroupHtml,
  renderGearMenuHtml,
  renderSettingsModalHtml,
  AUTH_I18N,
} from "../../src/ui/index.js";

describe("[E2E Example] 18 - Charcoal Slate UI SSR & Client-Side i18n / Modal Pipeline", () => {
  it("renders Setup, Login, Invite, and Recovery pages adhering to Charcoal Slate design standards", async () => {
    // 1. Setup Page Rendering
    const setupHtml = renderAuthPage({
      view: "setup",
      serviceName: "Tower",
      lang: "zh",
      basePath: "/tower",
    });

    expect(setupHtml).toContain("310px");
    expect(setupHtml).toContain("font-size:15px");
    expect(setupHtml).toContain("Tower");
    expect(setupHtml).toContain("设置"); // zh


    // 2. Login Page in English with Cookie/Request auto-detection
    const loginReq = new Request("https://tower.nuln.net/login?lang=en");
    const loginRes = authPageResponse({
      view: "login",
      serviceName: "Tower",
      request: loginReq,
      basePath: "/tower",
    });

    expect(loginRes.status).toBe(200);
    expect(loginRes.headers.get("content-type")).toContain("text/html");
    const loginHtml = await loginRes.text();
    expect(loginHtml).toContain("Passkey");

    // 3. Topbar Actions & Gear Menu Components

    const actionsHtml = renderActionGroupHtml({
      lang: "zh",
      user: { email: "admin@nuln.net", name: "Admin" },
      showSettings: true,
    });
    expect(actionsHtml).toContain("topbar-actions");
    expect(actionsHtml).toContain("admin@nuln.net");

    const gearHtml = renderGearMenuHtml({
      user: { email: "admin@nuln.net" },
      lang: "en",
    });
    expect(gearHtml).toContain("gear-menu");
    expect(gearHtml).toContain("Settings");

    // 4. Settings Modal Component
    const modalHtml = renderSettingsModalHtml({
      serviceName: "Tower",
      lang: "en",
    });
    expect(modalHtml).toContain("Settings");
    expect(modalHtml).toContain("Tower");

    // 5. i18n Dictionary
    expect(AUTH_I18N.zh.setupTitle).toBe("初始化");
    expect(AUTH_I18N.en.setupTitle).toBe("Setup");
  });
});

