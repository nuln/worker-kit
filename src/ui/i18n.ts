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
    // ── UI 通用文案（曾散落为三套并行字典，见文件末尾说明）──
    modalOk: "确定",
    modalCancel: "取消",
    modalConfirm: "确认",
    modalTitle: "提示",
    modalPromptTitle: "请输入",
    modalInputPh: "请输入",
    topbarSettings: "设置",
    topbarLogout: "退出登录",
    topbarLanguage: "切换为中文",
    topbarSwitchToZh: "中文",
    topbarSwitchToEn: "English",
    topbarTheme: "切换主题模式",
    topbarNotifications: "通知中心",
    topbarUserFallback: "用户",
    topbarNotificationsUnavailable: "通知中心尚未接入",
    themeDarkLabel: "深色模式",
    themeLightLabel: "浅色模式",
    themeSwitchedDark: "已切换为深色模式",
    themeSwitchedLight: "已切换为浅色模式",
    settingsTitle: "系统设置",
    settingsClose: "关闭",
    settingsSave: "保存修改",
    settingsTabGeneral: "常规与外观",
    settingsTabSecurity: "认证与安全",
    settingsTabStorage: "存储与备份",
    settingsTabPlugins: "插件与扩展",
    settingsTabAbout: "关于与系统",
    // ── 认证页 ──
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
    langToggleTitle: "切换语言",
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
    // ── Shared UI copy (previously three parallel dictionaries; see file footer) ──
    modalOk: "OK",
    modalCancel: "Cancel",
    modalConfirm: "Confirm",
    modalTitle: "Notice",
    modalPromptTitle: "Enter a value",
    modalInputPh: "Enter a value",
    topbarSettings: "Settings",
    topbarLogout: "Logout",
    topbarLanguage: "Switch to Chinese",
    topbarSwitchToZh: "中文",
    topbarSwitchToEn: "English",
    topbarTheme: "Toggle Theme",
    topbarNotifications: "Notifications",
    topbarUserFallback: "User",
    topbarNotificationsUnavailable: "Notification center is not available yet",
    themeDarkLabel: "Dark Mode",
    themeLightLabel: "Light Mode",
    themeSwitchedDark: "Switched to dark mode",
    themeSwitchedLight: "Switched to light mode",
    settingsTitle: "Settings",
    settingsClose: "Close",
    settingsSave: "Save Changes",
    settingsTabGeneral: "General & Appearance",
    settingsTabSecurity: "Auth & Security",
    settingsTabStorage: "Storage & Backup",
    settingsTabPlugins: "Plugins & Extensions",
    settingsTabAbout: "About & System",
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
    langToggleTitle: "Switch Language",
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

/**
 * 生成把双语文案注入客户端的 script 片段。
 *
 * ## 为什么需要它
 *
 * `modal.ts` / `topbar.ts` / `settings-modal.ts` 的内联脚本此前各自持有文案来源：
 * - modal.ts：多处硬编码中文字面量（确定/取消/确认/提示/请输入 …）
 * - topbar.ts：11 处 `isEn ? "…" : "…"` 三元表达式
 * - settings-modal.ts：局部 `const t = { … }` 8 键字典
 *
 * 加上 AUTH_I18N 本体，仓库里一度存在**四套**并行的 i18n。结果是英文用户在
 * 英文页面上看到「确定 / 取消」等中文按钮，且这类问题不会让任何测试变红
 * —— 因为每套都“自洽”。
 *
 * 现统一收敛到 AUTH_I18N：服务端按请求语言挑好文案，注入为
 * `window.__I18N__`，客户端脚本一律从该对象读取。
 *
 * @param lang 已解析的语言；缺省用 DEFAULT_LANG
 * @returns 可直接嵌入 script 的赋值语句
 */
export function i18nInjectionScript(lang?: string): string {
  return "<scr" + "ipt>" + i18nAssignment(lang) + "</scr" + "ipt>";
}

/**
 * 只返回赋值语句（不含 script 标签），用于**已有** script 块内部。
 *
 * 认证页的 WEBAUTHN_SCRIPT 已经是一个完整的 script 块，把带标签的注入
 * 字符串塞进去会产生嵌套 script（HTML 解析器只认第一个闭合标签，后续内容
 * 变成文本）—— 这类畸形结构不会让功能立刻坏掉，但会让后续脚本失效。
 *
 * @param lang 已解析的语言；缺省用 DEFAULT_LANG
 * @returns `window.__I18N__ = {…};` 形式的语句
 */
export function i18nAssignment(lang?: string): string {
  const dict = getAuthI18n(lang);
  // 手工转义 < > & 与 U+2028/9（与 script-safety.safeJsonForScript 同一集合）。
  // 此处不 import script-safety 是为避免 ui/i18n ↔ ui/script-safety 的潜在
  // 循环依赖。
  const json = JSON.stringify(dict)
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return "window.__I18N__ = " + json + ";"
}

/** 客户端侧的文案读取器（在浏览器脚本内使用）。取不到注入对象时回落 key 本身。 */
export const CLIENT_I18N_HELPER =
  "window.__t = function (key) { var d = window.__I18N__ || {};" +
  " return (key in d) ? d[key] : key; };";
