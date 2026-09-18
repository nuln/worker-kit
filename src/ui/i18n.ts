/**
 * @nuln/worker-kit/ui/i18n
 *
 * 轻量级双语字典（中英）与客户端切换支持
 */

export type Lang = "zh" | "en";
export const DEFAULT_LANG: Lang = "zh";

export function detectLanguage(request?: Request): Lang {
  if (!request || typeof request !== "object") return DEFAULT_LANG;
  try {
    if (request.url) {
      const url = new URL(request.url, "http://localhost");
      const q = url.searchParams.get("lang");
      if (q) {
        if (q.startsWith("en")) return "en";
        if (q.startsWith("zh")) return "zh";
      }
    }
  } catch (_) {}

  try {
    const cookie = request.headers?.get?.("cookie") || "";
    const match = cookie.match(/(?:^|;\s*)lang=([a-zA-Z-]+)(?:;|$)/);
    if (match) {
      if (match[1].startsWith("en")) return "en";
      if (match[1].startsWith("zh")) return "zh";
    }

    const accept = request.headers?.get?.("accept-language") || "";
    if (accept) {
      if (accept.includes("zh")) return "zh";
      if (accept.includes("en")) return "en";
    }
  } catch (_) {}

  return DEFAULT_LANG;
}

export function handleLangParam(request: Request, redirectPath = "/"): Response | null {
  const url = new URL(request.url);
  const lang = url.searchParams.get("lang");
  if (lang) {
    const norm = lang.startsWith("en") ? "en" : "zh";
    url.searchParams.delete("lang");
    const target = url.pathname + (url.search ? url.search : "");
    return new Response(null, {
      status: 302,
      headers: {
        Location: target || redirectPath,
        "Set-Cookie": `lang=${norm}; Path=/; Max-Age=31536000; SameSite=Lax`,
      },
    });
  }
  return null;
}

export function clientI18nScript(): string {
  return `
    function toggleLanguage() {
      const cur = document.cookie.match(/(?:^|;\\s*)lang=(zh|en)(?:;|$)/)?.[1] || (navigator.language?.startsWith('zh') ? 'zh' : 'en');
      const next = cur === 'zh' ? 'en' : 'zh';
      document.cookie = 'lang=' + next + '; Path=/; Max-Age=31536000; SameSite=Lax';
      window.location.reload();
    }
  `;
}

export function clientThemeScript(): string {
  return `<script>
function toggleTheme() {
  var cur = document.documentElement.getAttribute('data-theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  var next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('theme', next);
  } catch (e) {}
}
(function() {
  try {
    var stored = localStorage.getItem('theme');
    if (stored === 'dark' || stored === 'light') {
      document.documentElement.setAttribute('data-theme', stored);
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch (e) {}
})();
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
    var stored = localStorage.getItem('theme');
    if (!stored || stored === 'auto' || stored === 'system') {
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    }
  });
}
</script>`;
}

export const AUTH_I18N = {
  zh: {
    setupTitle: "初始化",
    setupSub: "首个账号将直接成为超级管理员",
    setupBtn: "设置",
    adminEmailLabel: "管理员邮箱",
    adminEmailPh: "管理员邮箱",
    adminNameLabel: "管理员名称",
    adminNamePh: "管理员名称（选填）",
    pkNameLabel: "Passkey 名称",
    pkNamePh: "Passkey 名称",
    loginTitle: "登录",
    loginSub: "请使用已绑定的凭据登录账户",
    loginWithPasskey: "使用 Passkey 登录",
    passkeyLogin: "Passkey",
    oidcLogin: "OIDC 单点登录",
    orDivider: "或使用其他方式",
    forgotAccount: "找回账号",
    uninitTitle: "✨ 系统处于未初始化状态",
    uninitSub: "首个账号将直接成为超级管理员",
    uninitBtn: "立即初始化超级管理员",
    inviteTitle: "受邀注册",
    inviteSub: "使用邀请码创建 Passkey 完成注册",
    inviteCodePh: "邀请码",
    emailPh: "电子邮箱",
    displayNamePh: "显示名称（选填）",
    pkRegisterBtn: "创建 Passkey 并注册",
    haveAccount: "已有账号？返回登录",
    recoveryTitle: "找回账号凭据",
    recoverySub: "输入注册时绑定的邮箱以获取登录链接",
    recoveryEmailPh: "注册时绑定的邮箱",
    recoveryBtn: "发送恢复邮件",
    backToLogin: "返回登录",
    themeToggleTitle: "切换主题模式（浅色/深色）",
    langToggleTitle: "切换语言 / Switch Language",
    noSecureCtx: "当前环境不支持 Passkey 生物识别，请使用 HTTPS 或 localhost 访问",
    passkeyFailed: "Passkey 快捷登录失败：",
    passkeyCanceled: "通行密钥验证已取消或超时，请重试",
    passkeySetupFailed: "Passkey 绑定未完成：{msg}。必须成功绑定 Passkey 才能完成站点初始化。",
    regFailed: "Passkey 注册失败",
    noDeviceCred: "设备未返回凭据",
    retryPasskeyLogin: "重试 Passkey 快捷登录",
    retryPasskeySetup: "重试注册并绑定 Passkey",
    inputEmailTip: "请输入管理员邮箱",
    ssoErrorTitle: "单点登录未完成",
    ssoErrorSub: "授权过程遇到异常或已超时，请重试",
    ssoRetryBtn: "重新发起单点登录",
    ssoBackBtn: "返回登录首页",
    consentTitle: "应用授权",
    consentSubtitle: "申请访问您的账户权限",
    consentScopesLabel: "请求的授权范围",
    consentAllowBtn: "允许访问",
    consentDenyBtn: "拒绝",
  },
  en: {
    setupTitle: "Setup",
    setupSub: "The first Passkey will become Super Admin",
    setupBtn: "Setup",
    adminEmailLabel: "Admin Email",
    adminEmailPh: "Admin Email",
    adminNameLabel: "Admin Name",
    adminNamePh: "Admin Name (Optional)",
    pkNameLabel: "Passkey Name",
    pkNamePh: "Passkey Name",
    loginTitle: "Sign In",
    loginSub: "Sign in with your configured credentials",
    loginWithPasskey: "Sign in with Passkey",
    passkeyLogin: "Passkey",
    oidcLogin: "OIDC Single Sign-On",
    orDivider: "or continue with",
    forgotAccount: "Recover Account",
    uninitTitle: "✨ System Uninitialized",
    uninitSub: "The first Passkey will become Super Admin",
    uninitBtn: "Initialize Admin Now",
    inviteTitle: "Invited Registration",
    inviteSub: "Create a Passkey with an invite code to register",
    inviteCodePh: "Invite Code",
    emailPh: "Email Address",
    displayNamePh: "Display Name (Optional)",
    pkRegisterBtn: "Create Passkey & Register",
    haveAccount: "Already have an account? Sign in",
    recoveryTitle: "Account Recovery",
    recoverySub: "Enter your registered email to receive a sign-in link",
    recoveryEmailPh: "Registered Email",
    recoveryBtn: "Send Recovery Email",
    backToLogin: "Back to Sign In",
    themeToggleTitle: "Toggle theme (Light/Dark)",
    langToggleTitle: "Switch Language / 切换语言",
    noSecureCtx: "Passkey WebAuthn is not supported in this environment. Please use HTTPS or localhost.",
    passkeyFailed: "Passkey Sign-in failed: ",
    passkeyCanceled: "Passkey operation was canceled or timed out, please retry.",
    passkeySetupFailed: "Passkey binding incomplete: {msg}. You must bind a Passkey to complete initialization.",
    regFailed: "Passkey registration failed",
    noDeviceCred: "Device returned no credential",
    retryPasskeyLogin: "Retry Passkey Sign-in",
    retryPasskeySetup: "Retry Passkey Registration",
    inputEmailTip: "Please enter admin email",
    ssoErrorTitle: "Single Sign-On Incomplete",
    ssoErrorSub: "The authorization process timed out or encountered an issue, please retry",
    ssoRetryBtn: "Retry Single Sign-On",
    ssoBackBtn: "Back to Login",
    consentTitle: "Authorize Application",
    consentSubtitle: "Requests access to your account",
    consentScopesLabel: "Requested Permissions",
    consentAllowBtn: "Allow Access",
    consentDenyBtn: "Deny",
  },
};

export function getAuthI18n(lang?: string): typeof AUTH_I18N.zh {
  const l = (lang && String(lang).startsWith("en")) ? "en" : "zh";
  return AUTH_I18N[l];
}

