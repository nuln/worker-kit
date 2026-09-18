/**
 * @nuln/worker-kit/ui/auth-pages
 *
 * 统一现代灰白极简（Charcoal Slate）Setup 与 Login 页面模板
 */

import { AUTH_STYLE, FAVICON_TAG } from "./styles.js";
import { escapeHtml } from "../http/index.js";
import { MODAL_JS } from "./modal.js";
import { getAuthI18n, detectLanguage, type Lang } from "./i18n.js";
import { AUTH_SYNC_SCRIPT } from "./auth-sync.js";

/**
 * 通用 PWA Head 标签
 */
export const PWA_HEAD_TAGS = `
  <meta name="theme-color" content="#18181b">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
`;

/**
 * 本地开发环境统一预填默认管理员凭据（单一事实来源）
 */
export const DEV_ADMIN_DEFAULTS = {
  email: "admin@nuln.net",
  localPart: "admin",
  name: "admin",
  pkName: "Passkey",
} as const;

/**
 * 判定请求是否来源于本地开发环境（localhost / 127.0.0.1 / ::1 / *.local / *.localhost）
 */
export function isLocalhost(reqOrHost?: Request | string | null): boolean {
  if (!reqOrHost) return false;
  if (typeof reqOrHost === "string") {
    const cleanHost = reqOrHost.trim().toLowerCase().replace(/:\d+$/, "");
    return (
      cleanHost === "localhost" ||
      cleanHost === "127.0.0.1" ||
      cleanHost === "[::1]" ||
      cleanHost === "::1" ||
      cleanHost.endsWith(".localhost") ||
      cleanHost.endsWith(".local")
    );
  }
  if (typeof reqOrHost === "object" && "url" in reqOrHost) {
    try {
      const u = new URL(reqOrHost.url);
      return isLocalhost(u.hostname);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * 获取环境自适应的初始化表单预填值：本地开发环境返回默认值，生产环境返回空字符串
 */
export function getDevSetupDefaults(reqOrHost?: Request | string | null): {
  email: string;
  localPart: string;
  name: string;
  pkName: string;
  isDev: boolean;
} {
  const isDev = isLocalhost(reqOrHost);
  return {
    email: isDev ? DEV_ADMIN_DEFAULTS.email : "",
    localPart: isDev ? DEV_ADMIN_DEFAULTS.localPart : "",
    name: isDev ? DEV_ADMIN_DEFAULTS.name : "",
    pkName: isDev ? DEV_ADMIN_DEFAULTS.pkName : "",
    isDev,
  };
}

function renderCapsuleHeader(serviceName: string): string {
  return `<div class="capsule-header">
    <div class="capsule-badge">
      <div class="capsule-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
      </div>
      <span>${escapeHtml(serviceName)}</span>
    </div>
  </div>`;
}

const WEBAUTHN_SCRIPT = (basePath: string, lang?: string) => {
  const t = getAuthI18n(lang);
  return `
<script>
${MODAL_JS}
const B = ${JSON.stringify(basePath)};
const P = (path) => B + path;
function alertDlg(){ if (typeof window !== 'undefined' && window.alertDlg) return window.alertDlg.apply(window, arguments); }
function confirmDlg(){ if (typeof window !== 'undefined' && window.confirmDlg) return window.confirmDlg.apply(window, arguments); }
function toast(){ if (typeof window !== 'undefined' && window.toast) return window.toast.apply(window, arguments); }
function b64urlToBuf(b){ const s = atob(b.replace(/-/g,'+').replace(/_/g,'/')); const u = new Uint8Array(s.length); for(let i=0;i<s.length;i++) u[i]=s.charCodeAt(i); return u.buffer; }
function bufToB64url(buf){ const u = new Uint8Array(buf); let s=''; for(let i=0;i<u.length;i++) s+=String.fromCharCode(u[i]); return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,''); }
function setMsg(m){ const el=document.getElementById('msg'); if(el) el.textContent=m; }
function escHtml(v){ return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

async function loginPasskey(){
  setMsg('');
  if (!window.isSecureContext || !navigator.credentials || !navigator.credentials.get) {
    const tip = ${JSON.stringify(t.noSecureCtx)};
    setMsg(tip);
    alertDlg(tip);
    return;
  }
  const btn = document.getElementById('main-btn') || document.getElementById('passkey-btn');
  const btnSpan = btn ? btn.querySelector('span') : null;
  if(btn) btn.disabled = true;
  try {
    const rOpt = await fetch(P('/api/auth/webauthn/login/options'), { method:'POST' });
    if(!rOpt.ok) {
      const e = await rOpt.json().catch(()=>({}));
      throw new Error(e.error || ${JSON.stringify(t.noDeviceCred)});
    }
    const { tmp, options } = await rOpt.json();
    options.challenge = b64urlToBuf(options.challenge);
    if(options.allowCredentials) options.allowCredentials = options.allowCredentials.map(c=>({...c, id: b64urlToBuf(c.id)}));

    const cred = await navigator.credentials.get({ publicKey: options });
    if(!cred) throw new Error(${JSON.stringify(t.noDeviceCred)});

    const vRes = await fetch(P('/api/auth/webauthn/login/verify'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tmp,
        response: {
          id: cred.id,
          rawId: bufToB64url(cred.rawId),
          type: cred.type,
          response: {
            clientDataJSON: bufToB64url(cred.response.clientDataJSON),
            authenticatorData: bufToB64url(cred.response.authenticatorData),
            signature: bufToB64url(cred.response.signature),
            userHandle: cred.response.userHandle ? bufToB64url(cred.response.userHandle) : null
          }
        }
      })
    });

    if(!vRes.ok) {
      const e = await vRes.json().catch(()=>({}));
      throw new Error(e.error || ${JSON.stringify(t.passkeyFailed)});
    }
    const data = await vRes.json();
    if (!data.ok && !data.redirect) {
      throw new Error(data.error || ${JSON.stringify(t.passkeyFailed)});
    }
    if (typeof window.broadcastAuthEvent === 'function') {
      window.broadcastAuthEvent('LOGIN');
    }
    location.href = data.redirect || P('/');
  } catch(e) {
    if(btn) btn.disabled = false;
    if(btnSpan) btnSpan.textContent = ${JSON.stringify(t.retryPasskeyLogin)};
    const msg = (e && (e.message || String(e))) || '';
    if (e && (e.name === 'NotAllowedError' || msg.includes('timed out') || msg.includes('not allowed') || msg.includes('The operation either timed out or was not allowed') || msg.includes('cancelled') || msg.includes('canceled') || msg.includes('AbortError'))) {
      const err = ${JSON.stringify(t.passkeyCanceled)};
      setMsg(err);
      alertDlg(err);
    } else {
      const err = ${JSON.stringify(t.passkeyFailed)} + (msg || ${JSON.stringify(t.noDeviceCred)});
      setMsg(err);
      alertDlg(err);
    }
  }
}

async function startConditionalLogin() {
  if (!window.isSecureContext || !navigator.credentials || !navigator.credentials.get) return;
  if (!window.PublicKeyCredential || typeof PublicKeyCredential.isConditionalMediationAvailable !== 'function') return;
  try {
    const available = await PublicKeyCredential.isConditionalMediationAvailable();
    if (!available) return;
    const rOpt = await fetch(P('/api/auth/webauthn/login/options'), { method:'POST' });
    if (!rOpt.ok) return;
    const { tmp, options } = await rOpt.json();
    options.challenge = b64urlToBuf(options.challenge);
    if(options.allowCredentials) options.allowCredentials = options.allowCredentials.map(c=>({...c, id: b64urlToBuf(c.id)}));

    const cred = await navigator.credentials.get({ publicKey: options, mediation: 'conditional' });
    if (!cred) return;

    const vRes = await fetch(P('/api/auth/webauthn/login/verify'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tmp,
        response: {
          id: cred.id,
          rawId: bufToB64url(cred.rawId),
          type: cred.type,
          response: {
            clientDataJSON: bufToB64url(cred.response.clientDataJSON),
            authenticatorData: bufToB64url(cred.response.authenticatorData),
            signature: bufToB64url(cred.response.signature),
            userHandle: cred.response.userHandle ? bufToB64url(cred.response.userHandle) : null
          }
        }
      })
    });
    if (vRes.ok) {
      const data = await vRes.json();
      if (data.ok || data.redirect) {
        if (typeof window.broadcastAuthEvent === 'function') {
          window.broadcastAuthEvent('LOGIN');
        }
        location.href = data.redirect || P('/');
      }
    }
  } catch(e) {}
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', startConditionalLogin);
  } else {
    startConditionalLogin();
  }
}

async function setupPasskey(){
  setMsg('');
  if (!window.isSecureContext || !navigator.credentials || !navigator.credentials.create) {
    const tip = ${JSON.stringify(t.noSecureCtx)};
    setMsg(tip);
    alertDlg(tip);
    return;
  }
  const email = (document.getElementById('email')?.value || '').trim();
  const name = (document.getElementById('name')?.value || '').trim();
  const pkName = (document.getElementById('pk-name')?.value || '').trim() || 'Master Passkey';
  if(!email) {
    const tip = ${JSON.stringify(t.inputEmailTip)};
    setMsg(tip);
    alertDlg(tip);
    return;
  }

  const btn = document.getElementById('setup-btn');
  const btnSpan = btn ? btn.querySelector('span') : null;
  if(btn) btn.disabled = true;
  try {
    const rOpt = await fetch(P('/api/setup/options'), {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ email, name, pkName })
    });
    if(!rOpt.ok) {
      const e = await rOpt.json().catch(()=>({}));
      throw new Error(e.error || '获取初始化参数失败');
    }
    const { tmp, options } = await rOpt.json();
    options.challenge = b64urlToBuf(options.challenge);
    options.user.id = b64urlToBuf(options.user.id);
    if(options.excludeCredentials) options.excludeCredentials = options.excludeCredentials.map(c=>({...c, id: b64urlToBuf(c.id)}));

    const cred = await navigator.credentials.create({ publicKey: options });
    if(!cred) throw new Error(${JSON.stringify(t.noDeviceCred)});

    const vRes = await fetch(P('/api/setup/verify'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tmp,
        pkName,
        email,
        name,
        response: {
          id: cred.id,
          rawId: bufToB64url(cred.rawId),
          type: cred.type,
          response: {
            clientDataJSON: bufToB64url(cred.response.clientDataJSON),
            attestationObject: bufToB64url(cred.response.attestationObject),
            transports: cred.response.getTransports ? cred.response.getTransports() : []
          }
        }
      })
    });

    if(!vRes.ok) {
      const e = await vRes.json().catch(()=>({}));
      throw new Error(e.error || '初始化验证失败');
    }
    const data = await vRes.json();
    if (!data.ok && !data.redirect) {
      throw new Error(data.error || '初始化验证失败');
    }
    if (typeof window.broadcastAuthEvent === 'function') {
      window.broadcastAuthEvent('LOGIN');
    }
    location.href = data.redirect || P('/');
  } catch(e) {
    if(btn) btn.disabled = false;
    if(btnSpan) btnSpan.textContent = ${JSON.stringify(t.retryPasskeySetup)};
    const msg = (e && (e.message || String(e))) || '';
    if (e && (e.name === 'NotAllowedError' || msg.includes('timed out') || msg.includes('not allowed') || msg.includes('The operation either timed out or was not allowed') || msg.includes('cancelled') || msg.includes('canceled') || msg.includes('AbortError'))) {
      const err = ${JSON.stringify(t.passkeyCanceled)};
      setMsg(err);
      alertDlg(err);
    } else {
      const tpl = ${JSON.stringify(t.passkeySetupFailed)};
      const err = tpl.replace('{msg}', msg || ${JSON.stringify(t.noDeviceCred)});
      setMsg(err);
      alertDlg(err);
    }
  }
}
</script>
`;
};

const TOP_RIGHT_TOGGLE = (lang?: string) => {
  const t = getAuthI18n(lang);
  return `
<div class="lang-toggle-wrap">
  <button type="button" class="lang-toggle-btn" onclick="toggleLanguage()" title="${t.langToggleTitle}" aria-label="Toggle language">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
  </button>
  <button type="button" class="theme-toggle-btn" onclick="toggleTheme()" title="${t.themeToggleTitle}" aria-label="Toggle theme">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
  </button>
</div>
`;
};

const THEME_SCRIPT = `
<script>
function toggleLanguage(){
  const cur = document.cookie.match(/(?:^|;\\s*)lang=([a-zA-Z-]+)(?:;|$)/)?.[1] || (navigator.language?.startsWith('zh') ? 'zh' : 'en');
  const next = cur.startsWith('zh') ? 'en' : 'zh';
  document.cookie = 'lang=' + next + '; Path=/; Max-Age=31536000; SameSite=Lax';
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('lang', next);
    window.location.href = url.toString();
  } catch(e) {
    window.location.reload();
  }
}
var __userThemeOverride = null;
function toggleTheme(forced){
  var sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var curTheme = __userThemeOverride || (sysDark ? 'dark' : 'light');
  var next = (forced === 'dark' || forced === 'light') ? forced : (curTheme === 'dark' ? 'light' : 'dark');
  __userThemeOverride = next;
  try {
    localStorage.removeItem('theme');
    document.documentElement.setAttribute('data-theme', next);
  } catch(e){}
}
(function(){
  try {
    document.documentElement.removeAttribute('data-theme');
  } catch(e){}
})();
</script>
`;

export type AuthPageView = "login" | "setup" | "invite" | "recovery" | "sso-error";

export interface AuthPageContract {
  view: AuthPageView;
  serviceName: string;
  basePath?: string;
  lang?: Lang | string;
  request?: Request;
  options?: {
    needsSetup?: boolean;
    oidcEnabled?: boolean;
    next?: string;
    defaultEmail?: string;
    inviteCode?: string;
    error?: string;
    errorDescription?: string;
    retryUrl?: string;
    loginUrl?: string;
  };
}

export function renderAuthPage(contract: AuthPageContract): string {
  const lang = contract.lang || (contract.request ? detectLanguage(contract.request) : undefined);
  switch (contract.view) {
    case "login":
      return renderLoginHtml({
        serviceName: contract.serviceName,
        basePath: contract.basePath,
        lang,
        request: contract.request,
        needsSetup: contract.options?.needsSetup,
        oidcEnabled: contract.options?.oidcEnabled,
        next: contract.options?.next,
      });
    case "setup":
      return renderSetupHtml({
        serviceName: contract.serviceName,
        basePath: contract.basePath,
        lang,
        request: contract.request,
        defaultEmail: contract.options?.defaultEmail,
      });
    case "invite":
      return renderInviteHtml({
        serviceName: contract.serviceName,
        basePath: contract.basePath,
        lang,
        request: contract.request,
        inviteCode: contract.options?.inviteCode,
      });
    case "recovery":
      return renderRecoveryHtml({
        serviceName: contract.serviceName,
        basePath: contract.basePath,
        lang,
        request: contract.request,
      });
    case "sso-error":
      return renderSsoErrorHtml({
        serviceName: contract.serviceName,
        basePath: contract.basePath,
        lang,
        request: contract.request,
        error: contract.options?.error,
        errorDescription: contract.options?.errorDescription,
        retryUrl: contract.options?.retryUrl,
        loginUrl: contract.options?.loginUrl,
      });
  }
}

export function authPageResponse(contract: AuthPageContract, init?: ResponseInit): Response {
  return new Response(renderAuthPage(contract), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...init?.headers,
    },
  });
}

export interface RenderLoginOptions {
  serviceName: string;
  basePath?: string;
  lang?: Lang | string;
  request?: Request;
  needsSetup?: boolean;
  oidcEnabled?: boolean;
  next?: string;
}

export function renderLoginHtml(opts: RenderLoginOptions): string {
  const b = opts.basePath || "";
  const name = opts.serviceName || "Service";
  const lang = opts.lang || (opts.request ? detectLanguage(opts.request) : undefined);
  const t = getAuthI18n(lang);
  const docLang = (lang && String(lang).startsWith("en")) ? "en" : "zh-CN";
  const oidcUrl = `${b}/oidc/login${opts.next ? `?next=${encodeURIComponent(opts.next)}` : ""}`;

  return `<!doctype html>
<html lang="${docLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>${escapeHtml(name)}</title>
  ${FAVICON_TAG}
  ${PWA_HEAD_TAGS}
  <style>${AUTH_STYLE}</style>
  ${AUTH_SYNC_SCRIPT}
  ${WEBAUTHN_SCRIPT(b, opts.lang)}
  ${THEME_SCRIPT}
</head>
<body>
  ${TOP_RIGHT_TOGGLE(opts.lang)}
  <div class="auth-wrap">
    <div class="card">
      ${renderCapsuleHeader(name)}

      ${opts.needsSetup ? `
      <div style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:var(--radius-sm);padding:10px 14px;font-size:12.5px;color:var(--text-primary);margin-bottom:14px;text-align:center">
        <div style="font-weight:600;margin-bottom:4px;color:var(--primary-color)">${t.uninitTitle}</div>
        <div style="color:var(--text-secondary);margin-bottom:8px">${t.uninitSub}</div>
        <a href="${b}/setup" class="btn primary" style="display:inline-flex;align-items:center;justify-content:center;gap:6px;width:100%;height:32px;font-size:12.5px;text-decoration:none;box-sizing:border-box">
          <span>${t.uninitBtn}</span>
        </a>
      </div>` : ""}

      <button id="main-btn" class="btn primary" onclick="loginPasskey()" style="height:38px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2m-1.5 1.5L13 10m2-4-2 2m-3-1a6.5 6.5 0 1 0 5 9.5L22 4l-2-2-4 4"/></svg>
        <span>${t.passkeyLogin}</span>
      </button>

      ${opts.oidcEnabled ? `
      <a href="${oidcUrl}" class="btn secondary" style="height:38px;margin-top:8px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        <span>${t.oidcLogin}</span>
      </a>` : ""}

      <div id="msg" class="msg"></div>

      <div class="auth-links"${!opts.needsSetup ? ' style="display:none"' : ' style="justify-content:center"'}>
        ${opts.needsSetup ? `<a href="${b}/setup" style="font-weight:600">${t.setupTitle}</a>` : ""}
      </div>
    </div>
  </div>
</body>
</html>`;
}

export interface RenderSetupOptions {
  serviceName: string;
  basePath?: string;
  lang?: Lang | string;
  request?: Request;
  defaultEmail?: string;
}

export function renderSetupHtml(opts: RenderSetupOptions): string {
  const b = opts.basePath || "";
  const name = opts.serviceName || "Service";
  const dev = getDevSetupDefaults(opts.request);
  const defEmail = dev.isDev ? (opts.defaultEmail || dev.email) : "";
  const defName = dev.name;
  const defPkName = dev.pkName;
  const lang = opts.lang || (opts.request ? detectLanguage(opts.request) : undefined);
  const t = getAuthI18n(lang);
  const docLang = (lang && String(lang).startsWith("en")) ? "en" : "zh-CN";

  return `<!doctype html>
<html lang="${docLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>${escapeHtml(name)}</title>
  ${FAVICON_TAG}
  ${PWA_HEAD_TAGS}
  <style>${AUTH_STYLE}</style>
  ${AUTH_SYNC_SCRIPT}
  ${WEBAUTHN_SCRIPT(b, lang)}
  ${THEME_SCRIPT}
</head>
<body>
  ${TOP_RIGHT_TOGGLE(lang)}
  <div class="auth-wrap">
    <div class="card">
      ${renderCapsuleHeader(name)}
      <h2 style="font-size:15px;font-weight:600;margin:0 0 14px 0;color:var(--text-primary);text-align:center;letter-spacing:-0.01em">${t.setupTitle}</h2>

      <input id="email" type="email" placeholder="${t.adminEmailPh}" value="${escapeHtml(defEmail)}" autocomplete="email" autofocus required>
      <input id="name" type="text" placeholder="${t.adminNamePh}" value="${escapeHtml(defName)}" autocomplete="name">
      <input id="pk-name" type="text" placeholder="${t.pkNamePh}" value="${escapeHtml(defPkName)}" maxlength="40" autocomplete="off">

      <button id="setup-btn" class="btn primary" onclick="setupPasskey()" style="height:38px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2m-1.5 1.5L13 10m2-4-2 2m-3-1a6.5 6.5 0 1 0 5 9.5L22 4l-2-2-4 4"/></svg>
        <span>${t.setupBtn}</span>
      </button>

      <div id="msg" class="msg"></div>
    </div>
  </div>
  <script>
    (function(){
      if (typeof window !== 'undefined' && window.location) {
        var host = (window.location.hostname || '').toLowerCase();
        if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host.endsWith('.localhost') || host.endsWith('.local')) {
          var e = document.getElementById('email'); if(e && !e.value) e.value = ${JSON.stringify(opts.defaultEmail || DEV_ADMIN_DEFAULTS.email)};
          var n = document.getElementById('name'); if(n && !n.value) n.value = ${JSON.stringify(DEV_ADMIN_DEFAULTS.name)};
          var p = document.getElementById('pk-name'); if(p && !p.value) p.value = ${JSON.stringify(DEV_ADMIN_DEFAULTS.pkName)};
        }
      }
    })();
  </script>
</body>
</html>`;
}

export interface RenderInviteOptions {
  serviceName: string;
  basePath?: string;
  lang?: Lang | string;
  request?: Request;
  inviteCode?: string;
}

export function renderInviteHtml(opts: RenderInviteOptions): string {
  const b = opts.basePath || "";
  const name = opts.serviceName || "Service";
  const code = opts.inviteCode || "";
  const lang = opts.lang || (opts.request ? detectLanguage(opts.request) : undefined);
  const t = getAuthI18n(lang);
  const docLang = (lang && String(lang).startsWith("en")) ? "en" : "zh-CN";

  return `<!doctype html>
<html lang="${docLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>${escapeHtml(name)}</title>
  ${FAVICON_TAG}
  ${PWA_HEAD_TAGS}
  <style>${AUTH_STYLE}</style>
  ${AUTH_SYNC_SCRIPT}
  ${WEBAUTHN_SCRIPT(b, lang)}
  ${THEME_SCRIPT}
</head>
<body>
  ${TOP_RIGHT_TOGGLE(lang)}
  <div class="auth-wrap">
    <div class="card">
      ${renderCapsuleHeader(name)}
      <div style="text-align:center;margin-bottom:4px">
        <h2 style="font-size:15px;font-weight:600;margin:0 0 4px 0;color:var(--text-primary)">${t.inviteTitle}</h2>
        <p style="font-size:12px;color:var(--text-secondary);margin:0;line-height:1.5">${t.inviteSub}</p>
      </div>

      <input id="invite-code" type="text" placeholder="${t.inviteCodePh}" value="${escapeHtml(code)}" ${code ? "readonly" : "autofocus"} required>
      <input id="email" type="email" placeholder="${t.emailPh}" required>
      <input id="name" type="text" placeholder="${t.displayNamePh}">
      <input id="pk-name" type="text" placeholder="${t.pkNamePh}" maxlength="40">

      <button id="setup-btn" class="btn primary" onclick="setupPasskey()" style="height:38px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2m-1.5 1.5L13 10m2-4-2 2m-3-1a6.5 6.5 0 1 0 5 9.5L22 4l-2-2-4 4"/></svg>
        <span>${t.pkRegisterBtn}</span>
      </button>

      <div id="msg" class="msg"></div>

      <div class="auth-links" style="justify-content:center">
        <a href="${b}/login">${t.haveAccount}</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export interface RenderRecoveryOptions {
  serviceName: string;
  basePath?: string;
  lang?: Lang | string;
  request?: Request;
}

export function renderRecoveryHtml(opts: RenderRecoveryOptions): string {
  const b = opts.basePath || "";
  const name = opts.serviceName || "Service";
  const lang = opts.lang || (opts.request ? detectLanguage(opts.request) : undefined);
  const t = getAuthI18n(lang);
  const docLang = (lang && String(lang).startsWith("en")) ? "en" : "zh-CN";

  return `<!doctype html>
<html lang="${docLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>${escapeHtml(name)}</title>
  ${FAVICON_TAG}
  ${PWA_HEAD_TAGS}
  <style>${AUTH_STYLE}</style>
  ${AUTH_SYNC_SCRIPT}
  ${THEME_SCRIPT}
</head>
<body>
  ${TOP_RIGHT_TOGGLE(lang)}
  <div class="auth-wrap">
    <div class="card">
      ${renderCapsuleHeader(name)}
      <div style="text-align:center;margin-bottom:4px">
        <h2 style="font-size:15px;font-weight:600;margin:0 0 4px 0;color:var(--text-primary)">${t.recoveryTitle}</h2>
        <p style="font-size:12px;color:var(--text-secondary);margin:0;line-height:1.5">${t.recoverySub}</p>
      </div>

      <input id="email" type="email" placeholder="${t.recoveryEmailPh}" autofocus required>

      <button id="recovery-btn" class="btn primary" onclick="sendRecoveryLink()" style="height:38px">
        <span>${t.recoveryBtn}</span>
      </button>

      <div id="msg" class="msg"></div>

      <div class="auth-links" style="justify-content:center">
        <a href="${b}/login">${t.backToLogin}</a>
      </div>
    </div>
  </div>
  <script>
    ${MODAL_JS}
    const B = ${JSON.stringify(b)};
    async function sendRecoveryLink() {
      const email = document.getElementById('email')?.value?.trim();
      if (!email) {
        alertDlg('请输入注册邮箱');
        return;
      }
      const btn = document.getElementById('recovery-btn');
      if (btn) btn.disabled = true;
      try {
        const res = await fetch(B + '/api/auth/recovery', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || '请求发送失败');
        alertDlg('恢复邮件已发送，请查收邮箱并按指引操作。');
      } catch (err) {
        if (btn) btn.disabled = false;
        alertDlg(err.message || '发送失败');
      }
    }
  </script>
</body>
</html>`;
}

export interface RenderSsoErrorOptions {
  serviceName: string;
  basePath?: string;
  lang?: Lang | string;
  request?: Request;
  error?: string;
  errorDescription?: string;
  retryUrl?: string;
  loginUrl?: string;
}

export function renderSsoErrorHtml(opts: RenderSsoErrorOptions): string {
  const b = opts.basePath || "";
  const name = opts.serviceName || "Service";
  const lang = opts.lang || (opts.request ? detectLanguage(opts.request) : undefined);
  const t = getAuthI18n(lang);
  const docLang = (lang && String(lang).startsWith("en")) ? "en" : "zh-CN";
  const errCode = opts.error ? escapeHtml(opts.error) : "";
  const errDesc = opts.errorDescription ? escapeHtml(opts.errorDescription) : "";
  const retryHref = opts.retryUrl || `${b}/oidc/login`;
  const loginHref = opts.loginUrl || `${b}/login`;

  return `<!doctype html>
<html lang="${docLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>${escapeHtml(name)} - ${t.ssoErrorTitle}</title>
  ${FAVICON_TAG}
  ${PWA_HEAD_TAGS}
  <style>${AUTH_STYLE}</style>
  ${AUTH_SYNC_SCRIPT}
  ${THEME_SCRIPT}
</head>
<body>
  ${TOP_RIGHT_TOGGLE(lang)}
  <div class="auth-wrap">
    <div class="card" style="text-align:center">
      ${renderCapsuleHeader(name)}
      <div style="margin:8px 0 16px">
        <div style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;background:rgba(239,68,68,0.1);color:#ef4444;margin-bottom:12px">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h2 style="font-size:15px;font-weight:600;margin:0 0 6px 0;color:var(--text-primary)">${t.ssoErrorTitle}</h2>
        <p style="font-size:12px;color:var(--text-secondary);margin:0;line-height:1.5">${t.ssoErrorSub}</p>
      </div>

      ${(errCode || errDesc) ? `
      <div style="background:var(--bg-secondary, rgba(0,0,0,0.03));border:1px solid var(--border-color, #e5e7eb);border-radius:8px;padding:10px 12px;margin-bottom:16px;text-align:left;font-size:11px;color:var(--text-secondary);word-break:break-all">
        ${errCode ? `<div style="font-weight:600;color:var(--text-primary);margin-bottom:2px">${errCode}</div>` : ""}
        ${errDesc ? `<div>${errDesc}</div>` : ""}
      </div>` : ""}

      <a href="${retryHref}" class="btn primary" style="display:flex;align-items:center;justify-content:center;height:38px;text-decoration:none;margin-bottom:8px">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px">
          <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
        </svg>
        <span>${t.ssoRetryBtn}</span>
      </a>

      <div class="auth-links" style="justify-content:center">
        <a href="${loginHref}">${t.ssoBackBtn}</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}




