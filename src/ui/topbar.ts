/**
 * @nuln/worker-kit/ui/topbar
 *
 * 顶栏与全局功能区通用生成器。
 * 遵循《SYSTEM_UNIFICATION_MASTER_SPEC.md》第 1 章节：
 * 操作区固定排列：[ 🌐 语言 ] -> [ 🌓 主题 ] -> [ 🔔 通知 ] -> [ 👤 头像角色 ] -> [ ⚙ 设置 / 🚪 退出 ]
 */

import { GlobeIcon, SunIcon, MoonIcon, MonitorIcon, SettingsIcon, LogOutIcon, BellIcon, UserIcon } from "./icons.js";
import type { Lang } from "./i18n.js";

export interface ActionGroupOptions {
  lang?: Lang;
  showLang?: boolean;
  showTheme?: boolean;
  showNotifications?: boolean;
  notificationsCount?: number;
  user?: {
    name?: string;
    email?: string;
    role?: string;
    avatar?: string;
  };
  showSettings?: boolean;
  onSettingsClick?: string; // e.g. "openSettingsModal()"
  showLogout?: boolean;
  onLogoutClick?: string;   // e.g. "logout()"
  basePath?: string;
}

/** 生成标准顶栏右侧操作区 HTML 字符串 */
export function renderActionGroupHtml(options: ActionGroupOptions = {}): string {
  const {
    lang = "zh",
    showLang = true,
    showTheme = true,
    showNotifications = false,
    notificationsCount = 0,
    user,
    showSettings = true,
    onSettingsClick = "openSettingsModal()",
    showLogout = true,
    onLogoutClick = "logout()",
  } = options;

  const isEn = (lang as string) === "en-US" || lang === "en";
  const items: string[] = [];

  // 1. 🌐 语言切换
  if (showLang) {
    items.push(
      `<button type="button" class="icon-btn lang-toggle-btn" onclick="toggleLanguage()" title="${isEn ? "Switch to Chinese" : "切换为中文"}" aria-label="Toggle Language">${GlobeIcon}</button>`
    );
  }

  // 2. 🌓 主题切换 (三态跟随系统)
  if (showTheme) {
    items.push(
      `<button type="button" class="icon-btn theme-toggle-btn" onclick="toggleTheme()" title="${isEn ? "Toggle Theme" : "切换主题模式"}" aria-label="Toggle Theme">${MoonIcon}</button>`
    );
  }

  // 3. 🔔 通知中心 (可选)
  if (showNotifications) {
    const badge = notificationsCount > 0
      ? `<span class="badge-dot">${notificationsCount > 99 ? "99+" : notificationsCount}</span>`
      : "";
    items.push(
      `<button type="button" class="icon-btn notif-btn" onclick="openNotificationsModal()" title="${isEn ? "Notifications" : "通知中心"}" aria-label="Notifications">${BellIcon}${badge}</button>`
    );
  }

  // 4. 👤 用户头像/角色 (可选)
  if (user && (user.name || user.email)) {
    const displayName = user.name || user.email?.split("@")[0] || "User";
    const initials = (user.name || displayName).slice(0, 2).toUpperCase();
    const roleTag = user.role ? `<span class="tag role-badge">${user.role}</span>` : "";
    items.push(
      `<div class="user-chip" title="${user.email || displayName}">` +
        `<span class="user-avatar">${user.avatar || initials}</span>` +
        `<span class="user-name">${displayName}</span>` +
        roleTag +
      `</div>`
    );
  }

  // 5. ⚙ 设置按钮 / 🚪 退出按钮
  if (showSettings) {
    items.push(
      `<button type="button" class="icon-btn settings-btn" onclick="${onSettingsClick}" title="${isEn ? "Settings" : "系统设置"}" aria-label="Settings">${SettingsIcon}</button>`
    );
  }

  if (showLogout) {
    items.push(
      `<button type="button" class="icon-btn logout-btn danger" onclick="${onLogoutClick}" title="${isEn ? "Logout" : "退出登录"}" aria-label="Logout">${LogOutIcon}</button>`
    );
  }

  return `<div class="topbar-actions">${items.join("")}</div>`;
}

/** 注入前端全局主题与多语言切换响应脚本 */
export function clientThemeAndLangScript(defaultLang: Lang = "zh"): string {
  return `
<script>
(function() {
  function getStoredTheme() {
    try { return localStorage.getItem('theme') || 'auto'; } catch(e) { return 'auto'; }
  }
  function applyTheme(th) {
    var isDark = th === 'dark' || ((th === 'auto' || !th) && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (th === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }
  applyTheme(getStoredTheme());
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
      var th = getStoredTheme();
      if (th === 'auto' || !th) applyTheme('auto');
    });
  }
  window.toggleTheme = function() {
    var cur = getStoredTheme();
    var next = cur === 'auto' ? 'light' : (cur === 'light' ? 'dark' : 'auto');
    try { localStorage.setItem('theme', next); } catch(e){}
    applyTheme(next);
    if (typeof showToast === 'function') {
      showToast(next === 'auto' ? '已设为跟随系统主题' : (next === 'dark' ? '已切换为深色模式' : '已切换为浅色模式'));
    }
  };
})();
</script>`;
}
