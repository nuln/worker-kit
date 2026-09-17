/**
 * Example 19: Progressive Web App (PWA) Manifest Generation
 *
 * Demonstrates:
 * 1. Dynamically generating standard `manifest.json` for Cloudflare Workers services
 * 2. Serving PWA manifest HTTP response with proper cache headers
 */

import {
  generatePwaManifest,
  pwaManifestResponse,
} from "@nuln/worker-kit";

export function handlePwaManifest(request: Request) {
  console.log("=== [Example 19] Dynamic PWA Manifest ===");

  // Serve manifest response
  return pwaManifestResponse({
    name: "Nuln Tower Control",
    shortName: "Tower",
    description: "Cloudflare Workers Edge Management Console",
    startUrl: "/tower/",
    themeColor: "#0f172a",
    backgroundColor: "#ffffff",
    icons: [
      { src: "/tower/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/tower/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  });
}
