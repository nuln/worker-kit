/**
 * @nuln/worker-kit/ui/auth-pages
 *
 * 统一现代灰白极简（Charcoal Slate）Setup 与 Login 页面模板
 */

import { AUTH_STYLE, FAVICON_TAG } from "./styles.js";
import { escapeHtml } from "../http/index.js";
import { MODAL_JS } from "./modal.js";

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

const WEBAUTHN_SCRIPT = (basePath: string) => `
<script>
${MODAL_JS}
const B = ${JSON.stringify(basePath)};
const P = (t) => B + t;
function b64urlToBuf(b){ const s = atob(b.replace(/-/g,'+').replace(/_/g,'/')); const u = new Uint8Array(s.length); for(let i=0;i<s.length;i++) u[i]=s.charCodeAt(i); return u.buffer; }
function bufToB64url(buf){ const u = new Uint8Array(buf); let s=''; for(let i=0;i<u.length;i++) s+=String.fromCharCode(u[i]); return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,''); }
function setMsg(m){ const el=document.getElementById('msg'); if(el) el.textContent=m; }
function escHtml(v){ return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

async function loginPasskey(){
  setMsg('');
  if (!window.isSecureContext || !navigator.credentials || !navigator.credentials.get) {
    const tip = '当前环境不支持 Passkey 生物识别，请使用 HTTPS 或 localhost 访问';
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
      throw new Error(e.error || '获取登录参数失败');
    }
    const { tmp, options } = await rOpt.json();
    options.challenge = b64urlToBuf(options.challenge);
    if(options.allowCredentials) options.allowCredentials = options.allowCredentials.map(c=>({...c, id: b64urlToBuf(c.id)}));

    const cred = await navigator.credentials.get({ publicKey: options });
    if(!cred) throw new Error('设备未返回凭据');

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
      throw new Error(e.error || 'Passkey 验证失败');
    }
    const data = await vRes.json();
    if (!data.ok && !data.redirect) {
      throw new Error(data.error || 'Passkey 验证失败');
    }
    location.href = data.redirect || P('/app') || P('/');
  } catch(e) {
    if(btn) btn.disabled = false;
    if(btnSpan) btnSpan.textContent = '重试 Passkey 快捷登录';
    const msg = (e && (e.message || String(e))) || '';
    if (e && (e.name === 'NotAllowedError' || msg.includes('timed out') || msg.includes('not allowed') || msg.includes('The operation either timed out or was not allowed') || msg.includes('cancelled') || msg.includes('canceled') || msg.includes('AbortError'))) {
      const err = '通行密钥验证已取消或超时，请重试';
      setMsg(err);
      alertDlg(err);
    } else {
      const err = 'Passkey 快捷登录失败：' + (msg || '设备未返回凭据');
      setMsg(err);
      alertDlg(err);
    }
  }
}

async function setupPasskey(){
  setMsg('');
  if (!window.isSecureContext || !navigator.credentials || !navigator.credentials.create) {
    const tip = '当前环境不支持 Passkey 生物识别，请使用 HTTPS 或 localhost 访问';
    setMsg(tip);
    alertDlg(tip);
    return;
  }
  const email = (document.getElementById('email')?.value || '').trim();
  const name = (document.getElementById('name')?.value || '').trim();
  const pkName = (document.getElementById('pk-name')?.value || '').trim() || 'Master Passkey';
  if(!email) {
    const tip = '请输入管理员邮箱';
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
    if(!cred) throw new Error('设备未返回凭据');

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
    location.href = data.redirect || P('/app') || P('/login') || P('/');
  } catch(e) {
    if(btn) btn.disabled = false;
    if(btnSpan) btnSpan.textContent = '重试注册并绑定 Passkey';
    const msg = (e && (e.message || String(e))) || '';
    if (e && (e.name === 'NotAllowedError' || msg.includes('timed out') || msg.includes('not allowed') || msg.includes('The operation either timed out or was not allowed') || msg.includes('cancelled') || msg.includes('canceled') || msg.includes('AbortError'))) {
      const err = '通行密钥验证已取消或超时，请重试';
      setMsg(err);
      alertDlg(err);
    } else {
      const err = 'Passkey 绑定未完成：' + (msg || '设备未返回凭据') + '。必须成功绑定 Passkey 才能完成站点初始化。';
      setMsg(err);
      alertDlg(err);
    }
  }
}
</script>
`;

const TOP_RIGHT_TOGGLE = `
<div class="lang-toggle-wrap">
  <button type="button" class="theme-toggle-btn" onclick="toggleTheme()" title="切换主题模式（浅色/深色）" aria-label="Toggle theme">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
  </button>
</div>
`;

const THEME_SCRIPT = `
<script>
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

export interface RenderLoginOptions {
  serviceName: string;
  basePath?: string;
  needsSetup?: boolean;
  oidcEnabled?: boolean;
  next?: string;
}

export function renderLoginHtml(opts: RenderLoginOptions): string {
  const b = opts.basePath || "";
  const name = opts.serviceName || "Service";
  const oidcUrl = `${b}/oidc/login${opts.next ? `?next=${encodeURIComponent(opts.next)}` : ""}`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>${escapeHtml(name)}</title>
  ${FAVICON_TAG}
  <style>${AUTH_STYLE}</style>
  ${WEBAUTHN_SCRIPT(b)}
  ${THEME_SCRIPT}
</head>
<body>
  ${TOP_RIGHT_TOGGLE}
  <div class="auth-wrap">
    <div class="card">
      ${renderCapsuleHeader(name)}

      ${opts.needsSetup ? `
      <div style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:var(--radius-sm);padding:10px 14px;font-size:12.5px;color:var(--text-primary);margin-bottom:14px;text-align:center">
        <div style="font-weight:600;margin-bottom:4px;color:var(--primary-color)">✨ 系统处于未初始化状态</div>
        <div style="color:var(--text-secondary);margin-bottom:8px">首个账号将直接成为超级管理员</div>
        <a href="${b}/setup" class="btn primary" style="display:inline-flex;align-items:center;justify-content:center;gap:6px;width:100%;height:32px;font-size:12.5px;text-decoration:none;box-sizing:border-box">
          <span>立即初始化超级管理员</span>
        </a>
      </div>` : ""}

      <button id="main-btn" class="btn primary" onclick="loginPasskey()" style="height:38px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2m-1.5 1.5L13 10m2-4-2 2m-3-1a6.5 6.5 0 1 0 5 9.5L22 4l-2-2-4 4"/></svg>
        <span>Passkey</span>
      </button>

      ${opts.oidcEnabled ? `
      <a href="${oidcUrl}" class="btn secondary" style="height:38px;margin-top:8px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        <span>OIDC 单点登录</span>
      </a>` : ""}

      <div id="msg" class="msg"></div>

      <div class="auth-links"${!opts.needsSetup ? ' style="display:none"' : ' style="justify-content:center"'}>
        ${opts.needsSetup ? `<a href="${b}/setup" style="font-weight:600">初始化超级管理员</a>` : ""}
      </div>
    </div>
  </div>
</body>
</html>`;
}

export interface RenderSetupOptions {
  serviceName: string;
  basePath?: string;
  defaultEmail?: string;
}

export function renderSetupHtml(opts: RenderSetupOptions): string {
  const b = opts.basePath || "";
  const name = opts.serviceName || "Service";
  const defEmail = opts.defaultEmail || "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>${escapeHtml(name)}</title>
  ${FAVICON_TAG}
  <style>${AUTH_STYLE}</style>
  ${WEBAUTHN_SCRIPT(b)}
  ${THEME_SCRIPT}
</head>
<body>
  ${TOP_RIGHT_TOGGLE}
  <div class="auth-wrap">
    <div class="card">
      ${renderCapsuleHeader(name)}
      <h2 style="font-size:18px;font-weight:700;margin:0 0 16px 0;color:var(--text-primary);text-align:center">初始化</h2>

      <input id="email" type="email" placeholder="管理员邮箱" value="${escapeHtml(defEmail)}" autocomplete="email" autofocus required>
      <input id="name" type="text" placeholder="管理员名称（选填）" autocomplete="name">
      <input id="pk-name" type="text" placeholder="Passkey 名称" maxlength="40" autocomplete="off">

      <button id="setup-btn" class="btn primary" onclick="setupPasskey()" style="height:38px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2m-1.5 1.5L13 10m2-4-2 2m-3-1a6.5 6.5 0 1 0 5 9.5L22 4l-2-2-4 4"/></svg>
        <span>设置</span>
      </button>

      <div id="msg" class="msg"></div>
    </div>
  </div>
</body>
</html>`;
}

export interface RenderInviteOptions {
  serviceName: string;
  basePath?: string;
  inviteCode?: string;
}

export function renderInviteHtml(opts: RenderInviteOptions): string {
  const b = opts.basePath || "";
  const name = opts.serviceName || "Service";
  const code = opts.inviteCode || "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>${escapeHtml(name)}</title>
  ${FAVICON_TAG}
  <style>${AUTH_STYLE}</style>
  ${WEBAUTHN_SCRIPT(b)}
  ${THEME_SCRIPT}
</head>
<body>
  ${TOP_RIGHT_TOGGLE}
  <div class="auth-wrap">
    <div class="card">
      ${renderCapsuleHeader(name)}
      <div style="text-align:center;margin-bottom:4px">
        <h2 style="font-size:18px;font-weight:700;margin:0 0 6px 0;color:var(--text-primary)">受邀注册</h2>
        <p style="font-size:12px;color:var(--text-secondary);margin:0;line-height:1.5">使用邀请码创建 Passkey 完成注册</p>
      </div>

      <input id="invite-code" type="text" placeholder="邀请码" value="${escapeHtml(code)}" ${code ? "readonly" : "autofocus"} required>
      <input id="email" type="email" placeholder="电子邮箱" required>
      <input id="name" type="text" placeholder="显示名称（选填）">
      <input id="pk-name" type="text" placeholder="Passkey 名称" maxlength="40">

      <button id="setup-btn" class="btn primary" onclick="setupPasskey()" style="height:38px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2m-1.5 1.5L13 10m2-4-2 2m-3-1a6.5 6.5 0 1 0 5 9.5L22 4l-2-2-4 4"/></svg>
        <span>创建 Passkey 并注册</span>
      </button>

      <div id="msg" class="msg"></div>

      <div class="auth-links" style="justify-content:center">
        <a href="${b}/login">已有账号？返回登录</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export interface RenderRecoveryOptions {
  serviceName: string;
  basePath?: string;
}

export function renderRecoveryHtml(opts: RenderRecoveryOptions): string {
  const b = opts.basePath || "";
  const name = opts.serviceName || "Service";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>${escapeHtml(name)}</title>
  ${FAVICON_TAG}
  <style>${AUTH_STYLE}</style>
  ${THEME_SCRIPT}
</head>
<body>
  ${TOP_RIGHT_TOGGLE}
  <div class="auth-wrap">
    <div class="card">
      ${renderCapsuleHeader(name)}
      <div style="text-align:center;margin-bottom:4px">
        <h2 style="font-size:18px;font-weight:700;margin:0 0 6px 0;color:var(--text-primary)">找回账号凭据</h2>
        <p style="font-size:12px;color:var(--text-secondary);margin:0;line-height:1.5">输入注册时绑定的邮箱以获取登录链接</p>
      </div>

      <input id="email" type="email" placeholder="注册时绑定的邮箱" autofocus required>

      <button id="recovery-btn" class="btn primary" onclick="sendRecoveryLink()" style="height:38px">
        <span>发送恢复邮件</span>
      </button>

      <div id="msg" class="msg"></div>

      <div class="auth-links" style="justify-content:center">
        <a href="${b}/login">返回登录</a>
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



