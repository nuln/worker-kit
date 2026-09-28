/**
 * Example 18: Charcoal Slate UI SSR & Interactive Settings Panel
 *
 * Demonstrates:
 * 1. Rendering unified Charcoal Slate Auth pages (Setup, Login, Invite, Recovery)
 * 2. Generating topbar action group with language, theme, and profile chips
 * 3. Rendering the 5-tab system settings modal
 */

import {
  renderAuthPage,
  renderActionGroupHtml,
  renderSettingsModalHtml,
  detectLanguage,
} from "@nuln/worker-kit";

export function renderFullDashboardHtml(request: Request) {
  console.log("=== [Example 18] Charcoal Slate UI SSR ===");

  const lang = detectLanguage(request);

  // 1. Topbar Actions
  const topbarHtml = renderActionGroupHtml({
    lang,
    user: { name: "Alice", email: "alice@nuln.net", role: "Admin" },
    showSettings: true,
    showNotifications: true,
    notificationsCount: 3,
  });

  // 2. Settings Modal
  const settingsModalHtml = renderSettingsModalHtml({
    serviceName: "Tower",
    version: "1.0.0",
    lang,
  });

  // 3. Auth Page SSR
  const loginPageHtml = renderAuthPage({
    view: "login",
    serviceName: "Tower",
    lang,
    basePath: "/tower",
  });

  return { topbarHtml, settingsModalHtml, loginPageHtml };
}
