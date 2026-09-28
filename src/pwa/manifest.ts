/**
 * @nuln/worker-kit/pwa/manifest
 *
 * 统一 PWA Web App 清单生成与 Service Worker 模板
 */

export interface PwaIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

export interface PwaManifestOptions {
  name: string;
  shortName: string;
  description?: string;
  startUrl?: string;
  scope?: string;
  display?: "standalone" | "fullscreen" | "minimal-ui" | "browser";
  themeColor?: string;
  backgroundColor?: string;
  icons?: PwaIcon[];
}

export function generatePwaManifest(options: PwaManifestOptions): object {
  return {
    name: options.name,
    short_name: options.shortName,
    description: options.description || `${options.name} - Nuln Edge Cloud`,
    start_url: options.startUrl || "/",
    scope: options.scope || "/",
    display: options.display || "standalone",
    theme_color: options.themeColor || "#18181b",
    background_color: options.backgroundColor || "#09090b",
    icons: options.icons || [
      {
        src: "/favicon.ico",
        sizes: "64x64 32x32 24x24 16x16",
        type: "image/x-icon",
      },
    ],
  };
}

export function pwaManifestResponse(options: PwaManifestOptions): Response {
  const manifest = generatePwaManifest(options);
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}

/**
 * 极简健壮的 Service Worker 脚本
 */
export const PWA_SERVICE_WORKER_SCRIPT = `
// Nuln PWA Service Worker
const CACHE_NAME = 'nuln-cache-v1';
const STATIC_ASSETS = ['/favicon.ico'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // 绕过 API 请求与 WebSocket 握手
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;

  event.respondWith(
    fetch(req).catch(() => caches.match(req).then((cached) => cached || Response.error()))
  );
});
`;
