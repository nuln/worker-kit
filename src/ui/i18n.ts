/**
 * @nuln/worker-kit/ui/i18n
 *
 * 轻量级双语字典（中英）与客户端切换支持
 */

export type Lang = "zh" | "en";
export const DEFAULT_LANG: Lang = "zh";

export function detectLanguage(request: Request): Lang {
  const url = new URL(request.url);
  const q = url.searchParams.get("lang");
  if (q === "zh" || q === "en") return q;

  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(/(?:^|;\s*)lang=(zh|en)(?:;|$)/);
  if (match) return match[1] as Lang;

  const accept = request.headers.get("accept-language") || "";
  if (accept.includes("zh")) return "zh";
  return "en";
}

export function handleLangParam(request: Request, redirectPath = "/"): Response | null {
  const url = new URL(request.url);
  const lang = url.searchParams.get("lang");
  if (lang === "zh" || lang === "en") {
    url.searchParams.delete("lang");
    const target = url.pathname + (url.search ? url.search : "");
    return new Response(null, {
      status: 302,
      headers: {
        Location: target || redirectPath,
        "Set-Cookie": `lang=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`,
      },
    });
  }
  return null;
}

export function clientI18nScript(): string {
  return `
    function toggleLanguage() {
      const cur = document.cookie.match(/(?:^|;\\s*)lang=(zh|en)(?:;|$)/)?.[1] || 'zh';
      const next = cur === 'zh' ? 'en' : 'zh';
      document.cookie = 'lang=' + next + '; Path=/; Max-Age=31536000; SameSite=Lax';
      window.location.reload();
    }
  `;
}
