/**
 * @nuln/worker-kit/ui/auth
 *
 * 统一认证 UI 模版组件与 Passkey 客户端脚本生成器
 */

import { AUTH_STYLE } from "./styles.js";

export interface AuthContainerOptions {
  title: string;
  subTitle?: string;
  brandName?: string;
  bodyHtml: string;
  lang?: string;
  headHtml?: string;
}

export interface ConfirmCardOptions {
  brandName?: string;
  title: string;
  message: string;
  warningText?: string;
  actionUrl: string;
  buttonText: string;
  csrfToken?: string;
  extraInputsHtml?: string;
  lang?: string;
}

export interface ErrorPageOptions {
  brandName?: string;
  title: string;
  message: string;
  backUrl?: string;
  backText?: string;
  lang?: string;
}

/** 生成轻量、原生 WebAuthn/Passkey 前端交互脚本（包含 base64url 双向编解码、凭据获取/创建与状态反馈） */
export function renderPasskeyClientScript(apiBasePath = ""): string {
  const base = apiBasePath.replace(/\/+$/, "");
  return `
<script>
function b64urlToBuf(s) {
  var b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  var pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  var bin = atob(b64 + pad);
  var buf = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
function bufToB64url(buf) {
  var bytes = new Uint8Array(buf);
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
}
async function startPasskeyLogin(optionsUrl, verifyUrl, redirectSuccess) {
  try {
    var optRes = await fetch(optionsUrl || '${base}/api/auth/webauthn/login/options', { method: 'POST' });
    if (!optRes.ok) throw new Error('Failed to get login options');
    var data = await optRes.json();
    var opts = data.options;
    opts.challenge = b64urlToBuf(opts.challenge);
    if (opts.allowCredentials) {
      opts.allowCredentials.forEach(function(c) { c.id = b64urlToBuf(c.id); });
    }
    var cred = await navigator.credentials.get({ publicKey: opts });
    var resPayload = {
      id: cred.id,
      rawId: bufToB64url(cred.rawId),
      type: cred.type,
      response: {
        authenticatorData: bufToB64url(cred.response.authenticatorData),
        clientDataJSON: bufToB64url(cred.response.clientDataJSON),
        signature: bufToB64url(cred.response.signature),
        userHandle: cred.response.userHandle ? bufToB64url(cred.response.userHandle) : null
      }
    };
    var verRes = await fetch(verifyUrl || '${base}/api/auth/webauthn/login/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tmp: data.tmp, response: resPayload })
    });
    if (!verRes.ok) {
      var err = await verRes.json().catch(function() { return {}; });
      throw new Error(err.error || 'Login verify failed');
    }
    window.location.href = redirectSuccess || '${base}/settings';
  } catch (err) {
    console.error('[Passkey] Error:', err);
    alert(err.message || 'Passkey 登录失败');
  }
}
</script>
`;
}

/** 渲染响应式认证外层卡片容器 */
export function renderAuthContainer(opts: AuthContainerOptions): string {
  const lang = opts.lang === "en" || opts.lang === "en-US" ? "en" : "zh-CN";
  const brand = opts.brandName || "Nuln";

  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${opts.title} - ${brand}</title>
  <style>
    ${AUTH_STYLE || ""}
  </style>
  ${opts.headHtml || ""}
</head>
<body>
  <div class="auth-wrap">
    <div class="auth-brand">
      <span>${brand}</span>
    </div>
    <div class="card">
      <h1>${opts.title}</h1>
      ${opts.subTitle ? `<p class="muted">${opts.subTitle}</p>` : ""}
      ${opts.bodyHtml}
    </div>
  </div>
</body>
</html>`;
}

/** 渲染确认操作卡片（如 Magic Link 预检二次确认） */
export function renderConfirmCard(opts: ConfirmCardOptions): string {
  const formHtml = `
    <form method="post" action="${opts.actionUrl}" style="margin-top:16px">
      ${opts.csrfToken ? `<input type="hidden" name="csrf" id="csrff" value="${opts.csrfToken}">` : ""}
      ${opts.extraInputsHtml || ""}
      <button type="submit" class="btn primary">${opts.buttonText}</button>
      <script>if(document.getElementById('csrff') && !document.getElementById('csrff').value)document.getElementById('csrff').value=(document.cookie.match(/csrf=([^;]+)/)||[])[1]||'';</script>
    </form>
  `;

  const bodyHtml = `
    <p class="muted">${opts.message}</p>
    ${opts.warningText ? `<p class="muted" style="font-size:12px;color:#ef4444">${opts.warningText}</p>` : ""}
    ${formHtml}
  `;

  return renderAuthContainer({
    title: opts.title,
    brandName: opts.brandName,
    bodyHtml,
    lang: opts.lang,
  });
}
