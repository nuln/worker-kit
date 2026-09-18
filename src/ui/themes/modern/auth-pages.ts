/**
 * @nuln/worker-kit/ui/themes/modern/auth-pages
 * 
 * Modern Passkey Card 认证页面模板（参考 Pocket-ID 现代卡片风）
 */

import { MODERN_AUTH_STYLE } from "./styles.js";
import { FAVICON_TAG } from "../../styles.js";
import { escapeHtml } from "../../../http/index.js";
import { MODAL_JS } from "../../modal.js";
import { getAuthI18n, detectLanguage } from "../../i18n.js";
import { AUTH_SYNC_SCRIPT } from "../../auth-sync.js";
import { PWA_HEAD_TAGS, isLocalhost, getDevSetupDefaults } from "../../auth-pages.js";
import type {
  RenderSetupOptions,
  RenderLoginOptions,
  RenderInviteOptions,
  RenderRecoveryOptions,
  RenderConsentOptions,
  RenderSsoErrorOptions,
  RenderOidcChoiceOptions,
} from "../types.js";

function renderModernBrandHeader(serviceName: string, subTitle?: string): string {
  return `
    <div class="brand-section">
      <div class="brand-icon-box">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
      </div>
      <h1 class="brand-title">${escapeHtml(serviceName)}</h1>
      ${subTitle ? `<p class="brand-desc">${escapeHtml(subTitle)}</p>` : ""}
    </div>
  `;
}

const MODERN_TOP_BAR = (lang?: string) => {
  const isEn = lang && String(lang).startsWith("en");
  return `
    <div class="top-floating-bar">
      <button class="floating-pill" type="button" onclick="toggleLang()" title="Switch Language">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
        <span>${isEn ? "EN" : "中"}</span>
      </button>
      <button class="floating-pill" type="button" onclick="toggleTheme()" title="Toggle Theme">
        <svg id="theme-icon-dark" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none">
          <circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>
        </svg>
        <svg id="theme-icon-light" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
        </svg>
      </button>
    </div>
  `;
};

const MODERN_THEME_SCRIPT = `
<script>
(function(){
  function getSysTheme(){ return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  function applyTheme(t){
    document.documentElement.setAttribute('data-theme', t);
    const darkIcon = document.getElementById('theme-icon-dark');
    const lightIcon = document.getElementById('theme-icon-light');
    if(darkIcon && lightIcon){
      if(t === 'dark'){ darkIcon.style.display='inline-block'; lightIcon.style.display='none'; }
      else { darkIcon.style.display='none'; lightIcon.style.display='inline-block'; }
    }
  }
  const saved = localStorage.getItem('theme') || getSysTheme();
  applyTheme(saved);
  window.toggleTheme = function(){
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    applyTheme(next);
  };
  window.toggleLang = function(){
    const url = new URL(location.href);
    const cur = url.searchParams.get('lang') || document.documentElement.lang || 'zh-CN';
    const next = cur.startsWith('en') ? 'zh-CN' : 'en-US';
    url.searchParams.set('lang', next);
    document.cookie = 'lang=' + next + ';path=/;max-age=31536000';
    location.href = url.toString();
  };
})();
</script>
`;

const MODERN_WEBAUTHN_SCRIPT = (basePath: string, lang?: string) => {
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

async function loginPasskey(){
  setMsg('');
  if (!window.isSecureContext || !navigator.credentials || !navigator.credentials.get) {
    const tip = ${JSON.stringify(t.noSecureCtx)};
    setMsg(tip);
    alertDlg(tip);
    return;
  }
  const btn = document.getElementById('main-passkey-btn');
  const btnSpan = btn ? btn.querySelector('span') : null;
  if(btn) { btn.disabled = true; btn.classList.add('authenticating'); }
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
    if(btn) { btn.disabled = false; btn.classList.remove('authenticating'); }
    if(btnSpan) btnSpan.textContent = ${JSON.stringify(t.retryPasskeyLogin)};
    const msg = (e && (e.message || String(e))) || '';
    if (e && (e.name === 'NotAllowedError' || msg.includes('timed out') || msg.includes('not allowed') || msg.includes('cancelled') || msg.includes('canceled') || msg.includes('AbortError'))) {
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
  if(btn) { btn.disabled = true; btn.classList.add('authenticating'); }
  try {
    const isInvite = !!document.getElementById('invite-code');
    const inviteCode = (document.getElementById('invite-code')?.value || '').trim();
    const optUrl = isInvite ? P('/api/auth/webauthn/invite/options') : P('/api/auth/webauthn/register/options');
    const verifyUrl = isInvite ? P('/api/auth/webauthn/invite/verify') : P('/api/auth/webauthn/register/verify');

    const optBody = isInvite ? { code: inviteCode, email, name, pkName } : { email, name, pkName };
    const rOpt = await fetch(optUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(optBody)
    });
    if(!rOpt.ok) {
      const e = await rOpt.json().catch(()=>({}));
      throw new Error(e.error || ${JSON.stringify(t.regFailed)});
    }
    const { tmp, options } = await rOpt.json();
    options.challenge = b64urlToBuf(options.challenge);
    options.user.id = b64urlToBuf(options.user.id);
    if(options.excludeCredentials) options.excludeCredentials = options.excludeCredentials.map(c=>({...c, id: b64urlToBuf(c.id)}));

    const cred = await navigator.credentials.create({ publicKey: options });
    if(!cred) throw new Error(${JSON.stringify(t.regFailed)});

    const vRes = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tmp,
        name,
        pkName,
        response: {
          id: cred.id,
          rawId: bufToB64url(cred.rawId),
          type: cred.type,
          response: {
            clientDataJSON: bufToB64url(cred.response.clientDataJSON),
            attestationObject: bufToB64url(cred.response.attestationObject)
          }
        }
      })
    });

    if(!vRes.ok) {
      const e = await vRes.json().catch(()=>({}));
      throw new Error(e.error || ${JSON.stringify(t.regFailed)});
    }
    const data = await vRes.json();
    if (!data.ok && !data.redirect) {
      throw new Error(data.error || ${JSON.stringify(t.regFailed)});
    }
    if (typeof window.broadcastAuthEvent === 'function') {
      window.broadcastAuthEvent('SETUP_COMPLETE');
    }
    location.href = data.redirect || P('/');
  } catch(e) {
    if(btn) { btn.disabled = false; btn.classList.remove('authenticating'); }
    const msg = (e && (e.message || String(e))) || '';
    if (e && (e.name === 'NotAllowedError' || msg.includes('cancelled') || msg.includes('canceled') || msg.includes('AbortError'))) {
      const err = ${JSON.stringify(t.passkeyCanceled)};
      setMsg(err);
      alertDlg(err);
    } else {
      const err = ${JSON.stringify(t.regFailed)} + (msg ? ': ' + msg : '');
      setMsg(err);
      alertDlg(err);
    }
  }
}
</script>
`;
};

export function renderModernSetupHtml(opts: RenderSetupOptions): string {
  const b = opts.basePath || "";
  const name = opts.serviceName || "Service";
  const lang = opts.lang || (opts.request ? detectLanguage(opts.request) : undefined);
  const t = getAuthI18n(lang);
  const docLang = (lang && String(lang).startsWith("en")) ? "en" : "zh-CN";

  const devDefaults = getDevSetupDefaults(opts.request);
  const emailVal = opts.email !== undefined ? opts.email : devDefaults.email;
  const nameVal = opts.name !== undefined ? opts.name : devDefaults.name;
  const pkNameVal = opts.pkName !== undefined ? opts.pkName : devDefaults.pkName;

  return `<!doctype html>
<html lang="${docLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>${escapeHtml(name)} - ${t.setupTitle}</title>
  ${FAVICON_TAG}
  ${PWA_HEAD_TAGS}
  <style>${MODERN_AUTH_STYLE}</style>
  ${AUTH_SYNC_SCRIPT}
  ${MODERN_WEBAUTHN_SCRIPT(b, lang)}
  ${MODERN_THEME_SCRIPT}
</head>
<body>
  ${MODERN_TOP_BAR(lang)}
  <div class="auth-layout">
    <div class="modern-card">
      ${renderModernBrandHeader(name, t.setupSub)}

      <div class="form-group">
        <label class="form-label" for="email">${t.adminEmailLabel}</label>
        <input id="email" class="form-input" type="email" placeholder="${t.emailPh}" value="${escapeHtml(emailVal)}" ${emailVal ? "" : "autofocus"} required>
      </div>

      <div class="form-group">
        <label class="form-label" for="name">${t.adminNameLabel}</label>
        <input id="name" class="form-input" type="text" placeholder="${t.displayNamePh}" value="${escapeHtml(nameVal)}">
      </div>

      <div class="form-group">
        <label class="form-label" for="pk-name">${t.pkNameLabel}</label>
        <input id="pk-name" class="form-input" type="text" placeholder="${t.pkNamePh}" value="${escapeHtml(pkNameVal)}" maxlength="40">
      </div>

      <button id="setup-btn" class="btn-passkey" onclick="setupPasskey()" style="margin-top:8px">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m21 2-2 2m-1.5 1.5L13 10m2-4-2 2m-3-1a6.5 6.5 0 1 0 5 9.5L22 4l-2-2-4 4"/>
        </svg>
        <span>${t.setupBtn}</span>
      </button>

      <div id="msg" class="msg-banner"></div>
    </div>
  </div>
</body>
</html>`;
}

export function renderModernLoginHtml(opts: RenderLoginOptions): string {
  const b = opts.basePath || "";
  const name = opts.serviceName || "Service";
  const lang = opts.lang || (opts.request ? detectLanguage(opts.request) : undefined);
  const t = getAuthI18n(lang);
  const docLang = (lang && String(lang).startsWith("en")) ? "en" : "zh-CN";
  const hasSso = Array.isArray(opts.ssoProviders) && opts.ssoProviders.length > 0;

  return `<!doctype html>
<html lang="${docLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>${escapeHtml(name)} - ${t.loginTitle}</title>
  ${FAVICON_TAG}
  ${PWA_HEAD_TAGS}
  <style>${MODERN_AUTH_STYLE}</style>
  ${AUTH_SYNC_SCRIPT}
  ${MODERN_WEBAUTHN_SCRIPT(b, lang)}
  ${MODERN_THEME_SCRIPT}
</head>
<body>
  ${MODERN_TOP_BAR(lang)}
  <div class="auth-layout">
    <div class="modern-card">
      ${renderModernBrandHeader(name, t.loginSub)}

      <button id="main-passkey-btn" class="btn-passkey" onclick="loginPasskey()" autofocus>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>
        </svg>
        <span>${t.loginWithPasskey}</span>
      </button>

      ${hasSso ? `
      <div class="divider"><span>${t.orDivider || "或使用其他方式"}</span></div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${opts.ssoProviders?.map(p => `
          <a href="${b}/oidc/login?provider=${encodeURIComponent(p.id)}" class="btn-outline">
            ${p.icon ? `<img src="${escapeHtml(p.icon)}" width="16" height="16" style="border-radius:4px" />` : ""}
            <span>${escapeHtml(p.name)}</span>
          </a>
        `).join("")}
      </div>` : ""}

      <div id="msg" class="msg-banner"></div>

      <div class="footer-links">
        ${opts.enableRecovery ? `<a href="${b}/recovery">${t.forgotAccount}</a>` : ""}
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function renderModernInviteHtml(opts: RenderInviteOptions): string {
  const b = opts.basePath || "";
  const name = opts.serviceName || "Service";
  const lang = opts.lang || (opts.request ? detectLanguage(opts.request) : undefined);
  const t = getAuthI18n(lang);
  const docLang = (lang && String(lang).startsWith("en")) ? "en" : "zh-CN";
  const code = opts.inviteCode || "";

  return `<!doctype html>
<html lang="${docLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>${escapeHtml(name)} - ${t.inviteTitle}</title>
  ${FAVICON_TAG}
  ${PWA_HEAD_TAGS}
  <style>${MODERN_AUTH_STYLE}</style>
  ${AUTH_SYNC_SCRIPT}
  ${MODERN_WEBAUTHN_SCRIPT(b, lang)}
  ${MODERN_THEME_SCRIPT}
</head>
<body>
  ${MODERN_TOP_BAR(lang)}
  <div class="auth-layout">
    <div class="modern-card">
      ${renderModernBrandHeader(name, t.inviteSub)}

      <div class="form-group">
        <label class="form-label" for="invite-code">${t.inviteCodePh}</label>
        <input id="invite-code" class="form-input" type="text" placeholder="${t.inviteCodePh}" value="${escapeHtml(code)}" ${code ? "readonly" : "autofocus"} required>
      </div>

      <div class="form-group">
        <label class="form-label" for="email">${t.emailPh}</label>
        <input id="email" class="form-input" type="email" placeholder="${t.emailPh}" value="${escapeHtml(opts.prefillEmail || "")}" required>
      </div>

      <div class="form-group">
        <label class="form-label" for="name">${t.displayNamePh}</label>
        <input id="name" class="form-input" type="text" placeholder="${t.displayNamePh}">
      </div>

      <div class="form-group">
        <label class="form-label" for="pk-name">${t.pkNamePh}</label>
        <input id="pk-name" class="form-input" type="text" placeholder="${t.pkNamePh}" maxlength="40">
      </div>

      <button id="setup-btn" class="btn-passkey" onclick="setupPasskey()" style="margin-top:8px">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m21 2-2 2m-1.5 1.5L13 10m2-4-2 2m-3-1a6.5 6.5 0 1 0 5 9.5L22 4l-2-2-4 4"/>
        </svg>
        <span>${t.pkRegisterBtn}</span>
      </button>

      <div id="msg" class="msg-banner"></div>

      <div class="footer-links">
        <a href="${b}/login">${t.haveAccount}</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function renderModernRecoveryHtml(opts: RenderRecoveryOptions): string {
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
  <title>${escapeHtml(name)} - ${t.recoveryTitle}</title>
  ${FAVICON_TAG}
  ${PWA_HEAD_TAGS}
  <style>${MODERN_AUTH_STYLE}</style>
  ${AUTH_SYNC_SCRIPT}
  ${MODERN_THEME_SCRIPT}
</head>
<body>
  ${MODERN_TOP_BAR(lang)}
  <div class="auth-layout">
    <div class="modern-card">
      ${renderModernBrandHeader(name, t.recoverySub)}

      <div class="form-group">
        <label class="form-label" for="email">${t.recoveryEmailPh}</label>
        <input id="email" class="form-input" type="email" placeholder="${t.recoveryEmailPh}" autofocus required>
      </div>

      <button id="recovery-btn" class="btn-passkey" onclick="sendRecoveryLink()" style="margin-top:8px">
        <span>${t.recoveryBtn}</span>
      </button>

      <div id="msg" class="msg-banner"></div>

      <div class="footer-links">
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

export function renderModernConsentHtml(opts: RenderConsentOptions): string {
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
  <title>${escapeHtml(opts.clientName)} - ${t.consentTitle || "应用授权"}</title>
  ${FAVICON_TAG}
  ${PWA_HEAD_TAGS}
  <style>${MODERN_AUTH_STYLE}</style>
  ${AUTH_SYNC_SCRIPT}
  ${MODERN_THEME_SCRIPT}
</head>
<body>
  ${MODERN_TOP_BAR(lang)}
  <div class="auth-layout">
    <div class="modern-card">
      <div class="brand-section">
        <div class="brand-icon-box" style="background:var(--bg-canvas-mesh1)">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 7h.01"/><path d="M17 7h.01"/><path d="M7 17h.01"/><path d="M17 17h.01"/>
          </svg>
        </div>
        <h1 class="brand-title">${escapeHtml(opts.clientName)}</h1>
        <p class="brand-desc">${t.consentSubtitle || "申请访问您的账户权限"}</p>
      </div>

      <div style="background:var(--bg-surface-elevated);border:1px solid var(--border-base);border-radius:12px;padding:12px 14px;margin-bottom:16px">
        <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:4px">授权身份账户</div>
        <div style="font-size:13.5px;font-weight:500;color:var(--text-primary)">${escapeHtml(opts.userName ? `${opts.userName} (${opts.userEmail})` : opts.userEmail)}</div>
      </div>

      <div class="form-label">${t.consentScopesLabel || "请求的授权范围"}</div>
      <div class="scope-pills">
        ${opts.scopes.map(s => `
          <div class="scope-pill">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>${escapeHtml(s)}</span>
          </div>
        `).join("")}
      </div>

      <form method="POST" action="${b}/oauth/consent" style="margin-top:20px;display:flex;flex-direction:column;gap:8px">
        <input type="hidden" name="csrf" value="${escapeHtml(opts.csrfToken)}">
        <input type="hidden" name="client_id" value="${escapeHtml(opts.clientId)}">
        <input type="hidden" name="action" value="allow">
        <button type="submit" class="btn-passkey">
          <span>${t.consentAllowBtn || "允许访问 (Allow)"}</span>
        </button>
        <button type="button" class="btn-outline" onclick="history.back()">
          <span>${t.consentDenyBtn || "拒绝 (Deny)"}</span>
        </button>
      </form>
    </div>
  </div>
</body>
</html>`;
}

export function renderModernSsoErrorHtml(opts: RenderSsoErrorOptions): string {
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
  <style>${MODERN_AUTH_STYLE}</style>
  ${AUTH_SYNC_SCRIPT}
  ${MODERN_THEME_SCRIPT}
</head>
<body>
  ${MODERN_TOP_BAR(lang)}
  <div class="auth-layout">
    <div class="modern-card" style="text-align:center">
      <div class="brand-section">
        <div class="brand-icon-box" style="background:var(--danger-bg);color:var(--danger);border-color:rgba(239,68,68,0.2)">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h1 class="brand-title">${t.ssoErrorTitle}</h1>
        <p class="brand-desc">${t.ssoErrorSub}</p>
      </div>

      ${(errCode || errDesc) ? `
      <div style="background:var(--bg-surface-elevated);border:1px solid var(--border-base);border-radius:10px;padding:10px 12px;margin-bottom:16px;text-align:left;font-size:12px;color:var(--text-secondary)">
        ${errCode ? `<div style="font-weight:600;color:var(--text-primary);margin-bottom:2px">${errCode}</div>` : ""}
        ${errDesc ? `<div>${errDesc}</div>` : ""}
      </div>` : ""}

      <a href="${retryHref}" class="btn-passkey" style="text-decoration:none;margin-bottom:8px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
        </svg>
        <span>${t.ssoRetryBtn}</span>
      </a>

      <div class="footer-links">
        <a href="${loginHref}">${t.ssoBackBtn}</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}
