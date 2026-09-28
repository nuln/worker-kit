import { describe, it, expect } from "vitest";
import { pwaManifestResponse, generatePwaManifest, PWA_SERVICE_WORKER_SCRIPT } from "../../src/pwa/index.js";

describe("[E2E Example] 19 - Progressive Web App (PWA) Manifest & Service Worker Delivery", () => {
  it("dynamically generates PWA manifest JSON and delivers lightweight Service Worker script", async () => {
    // 1. Dynamic Web App Manifest Response
    const manifestRes = pwaManifestResponse({
      name: "Nuln Mail Suite",
      shortName: "Mail",
      description: "Secure sovereign mail client",
      themeColor: "#0f172a",
      backgroundColor: "#ffffff",
      startUrl: "/mail/",
      display: "standalone",
    });

    expect(manifestRes.status).toBe(200);
    expect(manifestRes.headers.get("content-type")).toContain("application/manifest+json");

    const manifest = (await manifestRes.json()) as any;
    expect(manifest.name).toBe("Nuln Mail Suite");
    expect(manifest.short_name).toBe("Mail");
    expect(manifest.start_url).toBe("/mail/");
    expect(manifest.theme_color).toBe("#0f172a");

    // 2. Manifest Object Generation
    const rawManifest: any = generatePwaManifest({ name: "Tower", shortName: "Tower" });
    expect(rawManifest.name).toBe("Tower");

    // 3. Service Worker Script Template
    expect(PWA_SERVICE_WORKER_SCRIPT).toContain("self.addEventListener('install'");
    expect(PWA_SERVICE_WORKER_SCRIPT).toContain("caches.open");
  });
});
