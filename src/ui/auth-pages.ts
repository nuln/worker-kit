/**
 * @nuln/worker-kit/ui/auth-pages
 *
 * 统一现代灰白极简（Charcoal Slate）Setup 与 Login 页面模板
 */

import { DESIGN_TOKENS } from "./styles.js";
import { escapeHtml } from "../http/index.js";

const FAVICON_TAG = `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Crect width='512' height='512' rx='112' fill='%23181b20'/%3E%3Ccircle cx='256' cy='256' r='144' fill='none' stroke='%23ffffff' stroke-width='32' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cellipse cx='256' cy='256' rx='72' ry='144' fill='none' stroke='%23ffffff' stroke-width='32' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cline x1='112' y1='256' x2='400' y2='256' stroke='%23ffffff' stroke-width='32' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">`;

const AUTH_STYLE = `
${DESIGN_TOKENS}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--font-sans);
  background: var(--bg-canvas);
  color: var(--text-primary);
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  -webkit-font-smoothing: antialiased;
}
.auth-wrap { width: 100%; max-width: 380px; margin: 0 auto; }
.card {
  background: var(--bg-surface);
  border: 1px solid var(--border-base);
  border-radius: 16px;
  box-shadow: var(--shadow-modal);
  padding: 32px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.brand-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
}
.brand-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: 9999px;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  width: 100%;
  padding: 0 16px;
  border-radius: 10px;
  font-size: 13.5px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s ease;
  box-sizing: border-box;
}
.btn.primary { background: var(--primary); color: var(--primary-contrast); }
.btn.primary:hover { background: var(--primary-hover); }
.btn.secondary { background: var(--bg-subtle); color: var(--text-primary); border-color: var(--border-base); }
.btn.secondary:hover { background: var(--bg-hover); }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
input {
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--border-base);
  background: var(--bg-canvas);
  color: var(--text-primary);
  font-size: 13.5px;
  box-sizing: border-box;
}
input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 2px var(--primary-ring); }
.msg { font-size: 12px; color: var(--danger-text); text-align: center; min-height: 16px; }
.auth-links { display: flex; align-items: center; justify-content: center; gap: 12px; font-size: 12.5px; margin-top: 4px; }
.auth-links a { color: var(--text-secondary); text-decoration: none; }
.auth-links a:hover { color: var(--text-primary); text-decoration: underline; }
`;

const WEBAUTHN_SCRIPT = (basePath: string) => `
<script>
const B = ${JSON.stringify(basePath)};
const P = (t) => B + t;
function b64urlToBuf(b){ const s = atob(b.replace(/-/g,'+').replace(/_/g,'/')); const u = new Uint8Array(s.length); for(let i=0;i<s.length;i++) u[i]=s.charCodeAt(i); return u.buffer; }
function bufToB64url(buf){ const u = new Uint8Array(buf); let s=''; for(let i=0;i<u.length;i++) s+=String.fromCharCode(u[i]); return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,''); }
function setMsg(m){ const el=document.getElementById('msg'); if(el) el.textContent=m; }

async function loginPasskey(){
  setMsg('');
  if (!window.isSecureContext || !navigator.credentials || !navigator.credentials.get) {
    setMsg('当前环境不支持 Passkey 生物识别，请使用 HTTPS 或 localhost 访问');
    return;
  }
  const btn = document.getElementById('passkey-btn');
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
      setMsg('通行密钥验证已取消或超时，请重试');
    } else {
      setMsg(msg || 'Passkey 快捷登录失败');
    }
  }
}

async function setupPasskey(){
  setMsg('');
  if (!window.isSecureContext || !navigator.credentials || !navigator.credentials.create) {
    setMsg('当前环境不支持 Passkey 生物识别，请使用 HTTPS 或 localhost 访问');
    return;
  }
  const emailEl = document.getElementById('email');
  const email = emailEl ? emailEl.value.trim() : '';
  const pkName = (document.getElementById('pk-name')?.value || '').trim() || 'Master Passkey';
  if(!email) { setMsg('请输入管理员邮箱'); return; }

  const btn = document.getElementById('setup-btn');
  const btnSpan = btn ? btn.querySelector('span') : null;
  if(btn) btn.disabled = true;
  try {
    const rOpt = await fetch(P('/api/setup/options'), {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ email, name: pkName })
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
    location.href = data.redirect || P('/app') || P('/');
  } catch(e) {
    if(btn) btn.disabled = false;
    if(btnSpan) btnSpan.textContent = '重试注册并绑定 Passkey';
    const msg = (e && (e.message || String(e))) || '';
    if (e && (e.name === 'NotAllowedError' || msg.includes('timed out') || msg.includes('not allowed') || msg.includes('The operation either timed out or was not allowed') || msg.includes('cancelled') || msg.includes('canceled') || msg.includes('AbortError'))) {
      setMsg('通行密钥验证已取消或超时，请重试');
    } else {
      setMsg('Passkey 绑定未完成：' + (msg || '设备未返回凭据') + '。必须成功绑定 Passkey 才能完成站点初始化。');
    }
  }
}
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
  <title>${escapeHtml(name)} · 登录</title>
  ${FAVICON_TAG}
  <style>${AUTH_STYLE}</style>
  ${WEBAUTHN_SCRIPT(b)}
</head>
<body>
  <div class="auth-wrap">
    <div class="card">
      <div class="brand-header">
        <div class="brand-badge">
          <span>${escapeHtml(name)}</span>
        </div>
      </div>

      ${opts.needsSetup ? `
      <div style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.25);border-radius:10px;padding:12px;font-size:12.5px;text-align:center">
        <div style="font-weight:600;margin-bottom:4px;color:var(--text-primary)">✨ 系统处于未初始化状态</div>
        <div style="color:var(--text-secondary);margin-bottom:10px">首个绑定的 Passkey 将成为超级管理员</div>
        <a href="${b}/setup" class="btn primary" style="height:34px;font-size:12.5px">立即初始化管理员</a>
      </div>` : ""}

      <button id="passkey-btn" class="btn primary" onclick="loginPasskey()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2m-1.5 1.5L13 10m2-4-2 2m-3-1a6.5 6.5 0 1 0 5 9.5L22 4l-2-2-4 4"/></svg>
        <span>Passkey 快捷登录</span>
      </button>

      ${opts.oidcEnabled ? `
      <a href="${oidcUrl}" class="btn secondary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        <span>OIDC 单点登录</span>
      </a>` : ""}

      <div id="msg" class="msg"></div>
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
  const defEmail = opts.defaultEmail || "admin@local";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>${escapeHtml(name)} · 初始化管理员</title>
  ${FAVICON_TAG}
  <style>${AUTH_STYLE}</style>
  ${WEBAUTHN_SCRIPT(b)}
</head>
<body>
  <div class="auth-wrap">
    <div class="card">
      <div class="brand-header">
        <div class="brand-badge">
          <span>${escapeHtml(name)}</span>
        </div>
        <h2 style="font-size:16px;font-weight:700">初始化超级管理员</h2>
      </div>

      <input id="email" type="email" placeholder="管理员邮箱" value="${escapeHtml(defEmail)}" autofocus required>
      <input id="pk-name" type="text" placeholder="Passkey 凭据名称（如 Touch ID）" value="Master Passkey" required>

      <button id="setup-btn" class="btn primary" onclick="setupPasskey()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2m-1.5 1.5L13 10m2-4-2 2m-3-1a6.5 6.5 0 1 0 5 9.5L22 4l-2-2-4 4"/></svg>
        <span>注册并绑定 Passkey</span>
      </button>

      <div id="msg" class="msg"></div>

      <div class="auth-links">
        <a href="${b}/login">返回登录</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}
