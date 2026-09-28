/**
 * @nuln/worker-kit/ui/auth-pages
 *
 * 统一现代灰白极简（Charcoal Slate）Setup 与 Login 页面模板
 */

import { AUTH_STYLE, FAVICON_TAG, PAGE_TITLE_STYLE } from "./styles.js";
import { escapeHtml } from "../http/index.js";
import { DEV_ADMIN_DEFAULTS, getDevSetupDefaults, PWA_HEAD_TAGS } from "./dev-defaults.js";
import { isLocalhost } from "../urls/origin.js";
// 重新导出（保持公开 API 不变）：实现已移至 urls/origin 以断开
// basepath → ui/auth-pages → http → basepath 的运行时循环依赖。
// 一个轻量的路径工具把整个 UI 层拉进 bundle，会让只用 basepath 的
// Worker 凭空多出几十 KB。
export { isLocalhost };
import { MODAL_JS } from "./modal.js";
import { getAuthI18n, detectLanguage, i18nAssignment, type Lang } from "./i18n.js";
import { AUTH_SYNC_SCRIPT } from "./auth-sync.js";
import { applyCspNonce, safeJsonForScript, sanitizeBasePrefix } from "./script-safety.js";
import { renderMissingConfigPanel, MISSING_CONFIG_CSS } from "./missing-config.js";
import { evaluateRequirements } from "../config/requirements.js";
import type {
  UiTheme,
  AuthPageView,
  RenderSetupOptions,
  RenderLoginOptions,
  RenderInviteOptions,
  RenderRecoveryOptions,
  RenderConsentOptions,
  RenderSsoErrorOptions,
  RenderOidcChoiceOptions,
} from "./themes/types.js";
import {
  renderModernSetupHtml,
  renderModernLoginHtml,
  renderModernInviteHtml,
  renderModernRecoveryHtml,
  renderModernConsentHtml,
  renderModernSsoErrorHtml,
} from "./themes/modern/index.js";

/**
 * 自适应解析 UI 主题：支持代码参数显式传入、URL Query (?ui_theme= / ?theme=)、Cookie 以及环境变量 UI_THEME
 * 默认值为 "classic"（经典灰白极简 Charcoal-Slate 风格）
 */
export function resolveUiTheme(opts?: {
  theme?: UiTheme | string;
  request?: Request;
  env?: any;
}): UiTheme {
  if (opts?.theme === "modern" || opts?.theme === "classic") {
    return opts.theme;
  }
  if (opts?.request) {
    try {
      const url = new URL(opts.request.url);
      const qTheme = url.searchParams.get("ui_theme") || url.searchParams.get("theme");
      if (qTheme === "modern" || qTheme === "classic") return qTheme;

      const cookieHeader = opts.request.headers.get("cookie") || "";
      if (cookieHeader.includes("ui_theme=modern") || cookieHeader.includes("theme=modern")) return "modern";
      if (cookieHeader.includes("ui_theme=classic") || cookieHeader.includes("theme=classic")) return "classic";
    } catch {}
  }
  if (opts?.env?.UI_THEME === "modern" || opts?.env?.UI_THEME === "classic") {
    return opts.env.UI_THEME;
  }
  return "classic";
}


/**
 * 本地开发环境统一预填默认管理员凭据（单一事实来源）
 */


export { DEV_ADMIN_DEFAULTS, getDevSetupDefaults } from "./dev-defaults.js";
// PWA_HEAD_TAGS 同理：它是纯 HTML 片段，与"classic 认证页"毫无关系，
// 却让 modern 主题不得不反向依赖本模块 —— 依赖方向一乱就成环。
export { PWA_HEAD_TAGS } from "./dev-defaults.js";

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
${i18nAssignment(lang)}
${MODAL_JS}
const B = ${safeJsonForScript(basePath)};
const P = (path) => B + path;
function alertDlg(){ if (typeof window !== 'undefined' && window.alertDlg) return window.alertDlg.apply(window, arguments); }
function confirmDlg(){ if (typeof window !== 'undefined' && window.confirmDlg) return window.confirmDlg.apply(window, arguments); }
function toast(){ if (typeof window !== 'undefined' && window.toast) return window.toast.apply(window, arguments); }
function b64urlToBuf(b){ const s = atob(b.replace(/-/g,'+').replace(/_/g,'/')); const u = new Uint8Array(s.length); for(let i=0;i<s.length;i++) u[i]=s.charCodeAt(i); return u.buffer; }
function bufToB64url(buf){ const u = new Uint8Array(buf); let s=''; for(let i=0;i<u.length;i++) s+=String.fromCharCode(u[i]); return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,''); }
function setMsg(m){ const el=document.getElementById('msg'); if(el) el.textContent=m; }

/**
 * In-flight 互斥锁（KIT-BUG-05）
 *
 * 移动端/触摸屏上，点完按钮后 Touch ID / Face ID 弹窗需数秒准备。
 * 这期间再次点击或按回车会发出第二个 login/start 请求，服务端 challenge
 * 被后一个请求刷新 —— 先发请求的硬件验签返回 Invalid Challenge，
 * 用户看到"登录失败"，真实原因却是自己多点了一下。
 *
 * btn.disabled 挡不住三件事：① 按钮元素可能不存在；② data-action 事件
 * 委托直接调函数，不走按钮的 disabled 语义；③ 表单回车提交同样绕过。
 */
var __pkInFlight = false;
function __pkLock(){ if (__pkInFlight) return false; __pkInFlight = true; return true; }
function __pkUnlock(){ __pkInFlight = false; }
function escHtml(v){ return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function alignWebAuthnRpId(opts){
  if (!opts) return opts;
  const curHost = (typeof window !== 'undefined' && window.location && typeof window.location.hostname === 'string' ? window.location.hostname : '').toLowerCase();
  if (!curHost) return opts;
  if (/^[0-9.:[\]]+$/.test(curHost)) {
    if (opts.rp) delete opts.rp.id;
    delete opts.rpId;
    return opts;
  }
  if (opts.rp && opts.rp.id) {
    const rawRpId = String(opts.rp.id).toLowerCase();
    if (curHost !== rawRpId && !curHost.endsWith('.' + rawRpId)) {
      opts.rp.id = curHost;
    }
  }
  if (opts.rpId) {
    const rawRpId = String(opts.rpId).toLowerCase();
    if (curHost !== rawRpId && !curHost.endsWith('.' + rawRpId)) {
      opts.rpId = curHost;
    }
  }
  return opts;
}

async function loginPasskey(){
  if (!__pkLock()) return;
  setMsg('');
  if (!window.isSecureContext || !navigator.credentials || !navigator.credentials.get) {
    const tip = ${JSON.stringify(t.noSecureCtx)};
    setMsg(tip);
    alertDlg(tip);
    __pkUnlock();
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
    alignWebAuthnRpId(options);
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
  } finally {
    // 成功路径靠 location.href 跳转；取消 / 失败 / 未知异常都在此释放锁。
    // 漏释放会让用户一次失败后永久无法重试。
    __pkUnlock();
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
    alignWebAuthnRpId(options);
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
  if (!__pkLock()) return;
  setMsg('');
  if (!window.isSecureContext || !navigator.credentials || !navigator.credentials.create) {
    const tip = ${JSON.stringify(t.noSecureCtx)};
    setMsg(tip);
    alertDlg(tip);
    __pkUnlock();
    return;
  }
  const email = (document.getElementById('email')?.value || '').trim();
  const name = (document.getElementById('name')?.value || '').trim();
  const pkName = (document.getElementById('pk-name')?.value || '').trim() || 'Master Passkey';
  if(!email) {
    const tip = ${JSON.stringify(t.inputEmailTip)};
    setMsg(tip);
    alertDlg(tip);
    __pkUnlock();
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
    alignWebAuthnRpId(options);
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
  } finally {
    // 成功路径靠 location.href 跳转；其余分支在此释放锁
    __pkUnlock();
  }
}
/**
 * data-action 事件委托（AGENTS §14.3 / §18.1 零内联事件）。
 * 上面的 loginPasskey / setupPasskey / sendRecoveryLink 是 <script> 顶层
 * function 声明，在浏览器中本就是全局的；原按钮把这些函数直接写在 HTML 的
 * 内联事件属性里（历史故障 T-01 同类），改为委托转发后函数仍为全局，行为完全兼容。
 */
(function(){
  if (typeof document === 'undefined' || !document.addEventListener) return;
  var handlers = {
    'passkey-login': function () { if (typeof loginPasskey === 'function') loginPasskey(); },
    'passkey-setup': function () { if (typeof setupPasskey === 'function') setupPasskey(); },
    'recovery-link': function () { if (typeof sendRecoveryLink === 'function') sendRecoveryLink(); },
    'toggle-lang':   function () { if (typeof toggleLanguage === 'function') toggleLanguage(); },
    'toggle-theme':  function () { if (typeof toggleTheme === 'function') toggleTheme(); }
  };
  document.addEventListener('click', function (event) {
    var node = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
    if (!node) return;
    var fn = handlers[node.getAttribute('data-action')];
    if (!fn) return;
    event.preventDefault();
    fn();
  });
})();

</script>
`;
};

const TOP_RIGHT_TOGGLE = (lang?: string) => {
  const t = getAuthI18n(lang);
  return `
<div class="lang-toggle-wrap">
  <button type="button" class="lang-toggle-btn" data-action="toggle-lang" title="${t.langToggleTitle}" aria-label="Toggle language">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
  </button>
  <button type="button" class="theme-toggle-btn" data-action="toggle-theme" title="${t.themeToggleTitle}" aria-label="Toggle theme">
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

export interface AuthPageContract {
  view: AuthPageView;
  serviceName: string;
  basePath?: string;
  lang?: Lang | string;
  theme?: UiTheme;
  request?: Request;
  /**
   * CSP nonce（KIT-BUG-04）。
   *
   * 传入后所有内联 `<script>` / `<style>` 都会带上 `nonce` 属性，
   * 配合 `Content-Security-Policy: script-src 'nonce-...'` 响应头即可
   * 在严格 CSP 下正常工作。**不传则渲染结果与之前完全一致。**
   */
  cspNonce?: string;
  /**
   * Worker 环境对象。**仅 setup 视图使用**。
   *
   * 传入后 `/setup` 会先评估 `options.requirements`，缺配置时显示"需要配置
   * 什么"面板而不是初始化表单 —— 避免用户配完 Passkey 才发现邮件/限流没生效。
   */
  env?: Record<string, unknown> | null;
  /**
   * 初始化前置需求（纯数据）。**仅 setup 视图使用**。
   *
   * 新增环境变量只需往数组加一行，无需修改任何渲染代码 ——
   * 见 `@nuln/worker-kit/config` 的 `REQUIREMENTS` 与 `defineRequirements`。
   */
  requirements?: import("../config/requirements.js").Requirements;
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
    ssoProviders?: Array<{ id: string; name: string; icon?: string }>;
    enableRecovery?: boolean;
    /** 仅 `view: "consent"` 使用 */
    clientId?: string;
    clientName?: string;
    scopes?: string[];
    redirectUri?: string;
    userEmail?: string;
    userName?: string;
    csrfToken?: string;
  };
}

export function renderAuthPage(contract: AuthPageContract): string {
  // CSP nonce 在**渲染完成后**统一补：模板里有十几处内联 <script>，
  // 逐个条件插入极易漏，而漏掉的那一个恰恰让页面在该 CSP 下部分失效。
  // 无 nonce 时 `applyCspNonce` 原样返回，既有渲染结果不变。
  return applyCspNonce(renderAuthPageInner(contract), contract.cspNonce);
}

function renderAuthPageInner(contract: AuthPageContract): string {
  const lang = contract.lang || (contract.request ? detectLanguage(contract.request) : undefined);
  const theme = resolveUiTheme({ theme: contract.theme, request: contract.request });

  switch (contract.view) {
    case "login":
      return renderLoginHtml({
        serviceName: contract.serviceName,
        basePath: contract.basePath,
        lang,
        theme,
        request: contract.request,
        needsSetup: contract.options?.needsSetup,
        oidcEnabled: contract.options?.oidcEnabled,
        ssoProviders: contract.options?.ssoProviders,
        enableRecovery: contract.options?.enableRecovery,
        next: contract.options?.next,
      });
    case "setup":
      return renderSetupHtml({
        serviceName: contract.serviceName,
        basePath: contract.basePath,
        lang,
        theme,
        request: contract.request,
        defaultEmail: contract.options?.defaultEmail,
        // 初始化前置检查：缺配置时先显示缺什么，不进入初始化流程
        env: contract.env,
        requirements: contract.requirements,
      });
    case "invite":
      return renderInviteHtml({
        serviceName: contract.serviceName,
        basePath: contract.basePath,
        lang,
        theme,
        request: contract.request,
        inviteCode: contract.options?.inviteCode,
      });
    case "recovery":
      return renderRecoveryHtml({
        serviceName: contract.serviceName,
        basePath: contract.basePath,
        lang,
        theme,
        request: contract.request,
      });
    case "sso-error":
      return renderSsoErrorHtml({
        serviceName: contract.serviceName,
        basePath: contract.basePath,
        lang,
        theme,
        request: contract.request,
        error: contract.options?.error,
        errorDescription: contract.options?.errorDescription,
        retryUrl: contract.options?.retryUrl,
        loginUrl: contract.options?.loginUrl,
      });
    case "consent":
      // 授权同意页目前只有 modern 一套设计，故不论 theme 都用它；
      // 必填字段已由 renderModernConsentHtml 内部归一，服务端漏传不会白屏。
      return renderModernConsentHtml({
        serviceName: contract.serviceName,
        basePath: contract.basePath,
        lang,
        theme,
        request: contract.request,
        clientId: contract.options?.clientId ?? "",
        clientName: contract.options?.clientName ?? "",
        scopes: contract.options?.scopes ?? [],
        redirectUri: contract.options?.redirectUri ?? "",
        userEmail: contract.options?.userEmail ?? "",
        userName: contract.options?.userName ?? "",
        csrfToken: contract.options?.csrfToken ?? "",
      });
    default:
      // 未知 view 曾静默返回空串 → 认证页白屏，且日志里什么都没有。
      // 类型系统能挡住拼错的字面量，但挡不住来自外部的字符串。
      // 显式抛错：宁可 500 也不要白屏。
      throw new Error(
        `renderAuthPage: unknown view ${String((contract as { view: unknown }).view)}`,
      );
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

export function renderLoginHtml(opts: RenderLoginOptions): string {
  const theme = resolveUiTheme({ theme: opts.theme, request: opts.request });
  if (theme === "modern") {
    return renderModernLoginHtml(opts);
  }

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
  ${AUTH_SYNC_SCRIPT(b)}
  ${WEBAUTHN_SCRIPT(b, lang)}
  ${THEME_SCRIPT}
</head>
<body>
  ${TOP_RIGHT_TOGGLE(lang)}
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

      <button id="main-btn" class="btn primary" data-action="passkey-login" style="height:38px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2m-1.5 1.5L13 10m2-4-2 2m-3-1a6.5 6.5 0 1 0 5 9.5L22 4l-2-2-4 4"/></svg>
        <span>${t.passkeyLogin}</span>
      </button>

      ${opts.oidcEnabled ? `
      <a href="${escapeHtml(oidcUrl)}" class="btn secondary" style="height:38px;margin-top:8px;text-decoration:none">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        <span>${escapeHtml(opts.oidcButtonText || t.oidcLogin)}</span>
      </a>` : ""}

      <div id="msg" class="msg">${escapeHtml(opts.error || "")}</div>

      <div class="auth-links"${!opts.needsSetup ? ' style="display:none"' : ' style="justify-content:center"'}>
        ${opts.needsSetup ? `<a href="${b}/setup" style="font-weight:600">${t.setupTitle}</a>` : ""}
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function renderSetupHtml(opts: RenderSetupOptions): string {
  const theme = resolveUiTheme({ theme: opts.theme, request: opts.request });
  if (theme === "modern") {
    return renderModernSetupHtml(opts);
  }

  const b = opts.basePath || "";
  const name = opts.serviceName || "Service";
  const dev = getDevSetupDefaults(opts.request);
  const defEmail = dev.isDev ? (opts.defaultEmail || dev.email) : "";
  const defName = dev.name;
  const defPkName = dev.pkName;
  const lang = opts.lang || (opts.request ? detectLanguage(opts.request) : undefined);
  const t = getAuthI18n(lang);
  const docLang = (lang && String(lang).startsWith("en")) ? "en" : "zh-CN";

  // 初始化前置检查：缺配置时**先告诉用户缺什么**，不进入初始化流程。
  // 完全数据驱动 —— 新增环境变量只需往 requirements 数组加一行。
  const reqs = opts.requirements ?? [];
  const gate = reqs.length > 0 && opts.env ? evaluateRequirements(opts.env, reqs) : null;
  const blocked = !!gate && gate.blocking.length > 0;

  const body = blocked
    ? renderMissingConfigPanel({
        serviceName: name,
        blocking: gate!.blocking,
        advisory: gate!.advisory,
        lang,
        configuredCount: reqs.length - gate!.all.length,
        totalCount: reqs.length,
      })
    : `
      <input id="email" type="email" placeholder="${t.adminEmailPh}" value="${escapeHtml(defEmail)}" autocomplete="email" autofocus required>
      <input id="name" type="text" placeholder="${t.adminNamePh}" value="${escapeHtml(defName)}" autocomplete="name">
      <input id="pk-name" type="text" placeholder="${t.pkNamePh}" value="${escapeHtml(defPkName)}" maxlength="40" autocomplete="off">

      <button id="setup-btn" class="btn primary" data-action="passkey-setup" style="height:38px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2m-1.5 1.5L13 10m2-4-2 2m-3-1a6.5 6.5 0 1 0 5 9.5L22 4l-2-2-4 4"/></svg>
        <span>${t.setupBtn}</span>
      </button>

      <div id="msg" class="msg"></div>
    `;

  return `<!doctype html>
<html lang="${docLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>${escapeHtml(name)}</title>
  ${FAVICON_TAG}
  ${PWA_HEAD_TAGS}
  <style>${AUTH_STYLE}${MISSING_CONFIG_CSS}</style>
  ${AUTH_SYNC_SCRIPT(b)}
  ${blocked ? "" : WEBAUTHN_SCRIPT(b, lang)}
  ${THEME_SCRIPT}
</head>
<body>
  ${TOP_RIGHT_TOGGLE(lang)}
  <div class="auth-wrap">
    <div class="card">
      ${renderCapsuleHeader(name)}
      <h2 style="${PAGE_TITLE_STYLE}color:var(--text-primary);text-align:center">${blocked ? (docLang === "en" ? "Configuration Required" : "需要先完成配置") : t.setupTitle}</h2>
      ${body}
    </div>
  </div>
  <script>
    (function(){
      if (typeof window !== 'undefined' && window.location) {
        var host = (window.location.hostname || '').toLowerCase();
        if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host.endsWith('.localhost') || host.endsWith('.local')) {
          var e = document.getElementById('email'); if(e && !e.value) e.value = ${safeJsonForScript(opts.defaultEmail || DEV_ADMIN_DEFAULTS.email)};
          var n = document.getElementById('name'); if(n && !n.value) n.value = ${JSON.stringify(DEV_ADMIN_DEFAULTS.name)};
          var p = document.getElementById('pk-name'); if(p && !p.value) p.value = ${JSON.stringify(DEV_ADMIN_DEFAULTS.pkName)};
        }
      }
    })();
  </script>
</body>
</html>`;
}

export function renderInviteHtml(opts: RenderInviteOptions): string {
  const theme = resolveUiTheme({ theme: opts.theme, request: opts.request });
  if (theme === "modern") {
    return renderModernInviteHtml(opts);
  }

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
  ${AUTH_SYNC_SCRIPT(b)}
  ${WEBAUTHN_SCRIPT(b, lang)}
  ${THEME_SCRIPT}
</head>
<body>
  ${TOP_RIGHT_TOGGLE(lang)}
  <div class="auth-wrap">
    <div class="card">
      ${renderCapsuleHeader(name)}
      <div style="text-align:center;margin-bottom:4px">
        <h2 style="${PAGE_TITLE_STYLE}color:var(--text-primary)">${t.inviteTitle}</h2>
        <p style="font-size:12px;color:var(--text-secondary);margin:0;line-height:1.5">${t.inviteSub}</p>
      </div>

      <input id="invite-code" type="text" placeholder="${t.inviteCodePh}" value="${escapeHtml(code)}" ${code ? "readonly" : "autofocus"} required>
      <input id="email" type="email" placeholder="${t.emailPh}" value="${escapeHtml(opts.prefillEmail || "")}" required>
      <input id="name" type="text" placeholder="${t.displayNamePh}">
      <input id="pk-name" type="text" placeholder="${t.pkNamePh}" maxlength="40">

      <button id="setup-btn" class="btn primary" data-action="passkey-setup" style="height:38px">
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

export function renderRecoveryHtml(opts: RenderRecoveryOptions): string {
  const theme = resolveUiTheme({ theme: opts.theme, request: opts.request });
  if (theme === "modern") {
    return renderModernRecoveryHtml(opts);
  }

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
  ${AUTH_SYNC_SCRIPT(b)}
  ${THEME_SCRIPT}
</head>
<body>
  ${TOP_RIGHT_TOGGLE(lang)}
  <div class="auth-wrap">
    <div class="card">
      ${renderCapsuleHeader(name)}
      <div style="text-align:center;margin-bottom:4px">
        <h2 style="${PAGE_TITLE_STYLE}color:var(--text-primary)">${t.recoveryTitle}</h2>
        <p style="font-size:12px;color:var(--text-secondary);margin:0;line-height:1.5">${t.recoverySub}</p>
      </div>

      <input id="email" type="email" placeholder="${t.recoveryEmailPh}" autofocus required>

      <button id="recovery-btn" class="btn primary" data-action="recovery-link" style="height:38px">
        <span>${t.recoveryBtn}</span>
      </button>

      <div id="msg" class="msg"></div>

      <div class="auth-links" style="justify-content:center">
        <a href="${b}/login">${t.backToLogin}</a>
      </div>
    </div>
  </div>
  <script>
    ${i18nAssignment(lang)}
${MODAL_JS}
    const B = ${safeJsonForScript(b)};
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

export function renderSsoErrorHtml(opts: RenderSsoErrorOptions): string {
  const theme = resolveUiTheme({ theme: opts.theme, request: opts.request });
  if (theme === "modern") {
    return renderModernSsoErrorHtml(opts);
  }

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
  ${AUTH_SYNC_SCRIPT(b)}
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
        <h2 style="${PAGE_TITLE_STYLE}color:var(--text-primary)">${t.ssoErrorTitle}</h2>
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




