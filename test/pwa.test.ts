import { describe, it, expect } from "vitest";
import { generatePwaManifest, pwaManifestResponse, PWA_SERVICE_WORKER_SCRIPT } from "../src/pwa/manifest.js";

describe("PWA Manifest & Service Worker", () => {
  it("generatePwaManifest creates valid manifest structure", () => {
    const manifest = generatePwaManifest({
      name: "Nuln Mail",
      shortName: "Mail",
      description: "Secure Edge Mail",
      themeColor: "#000000",
    }) as any;

    expect(manifest.name).toBe("Nuln Mail");
    expect(manifest.short_name).toBe("Mail");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBe("#000000");
    expect(manifest.background_color).toBe("#09090b");
    expect(manifest.icons).toHaveLength(1);
  });

  it("pwaManifestResponse returns correct headers and status", async () => {
    const res = pwaManifestResponse({
      name: "Tower Dashboard",
      shortName: "Tower",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/manifest+json");
    expect(res.headers.get("cache-control")).toContain("public");
    const json = (await res.json()) as any;
    expect(json.name).toBe("Tower Dashboard");
  });

  it("PWA_SERVICE_WORKER_SCRIPT contains fetch and cache handlers", () => {
    expect(PWA_SERVICE_WORKER_SCRIPT).toContain("self.addEventListener('install'");
    expect(PWA_SERVICE_WORKER_SCRIPT).toContain("self.addEventListener('fetch'");
    expect(PWA_SERVICE_WORKER_SCRIPT).toContain("caches.open");
  });
});
