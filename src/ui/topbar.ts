/**
 * @nuln/worker-kit/ui/topbar
 *
 * 顶栏与全局功能区通用生成器。
 * 遵循《SYSTEM_UNIFICATION_MASTER_SPEC.md》第 1 章节：
 * 操作区固定排列：[ 🌐 语言 ] -> [ 🌓 主题 ] -> [ 🔔 通知 ] -> [ 👤 头像角色 ] -> [ ⚙ 设置 / 🚪 退出 ]
 */

import { GlobeIcon, SunIcon, MoonIcon, MonitorIcon, SettingsIcon, LogOutIcon, BellIcon, UserIcon } from "./icons.js";
import { getAuthI18n } from "./i18n.js";
import { escapeHtml } from "../http/index.js";
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
  onSettingsClick?: string;
  showLogout?: boolean;
  onLogoutClick?: string;
  basePath?: string;
}

/**
 * 齿轮菜单 / 顶栏动作组选项。
 *
 * `onSettingsClick` / `onLogoutClick` 为**相对或绝对 URL**（不是 JS 表达式），
 * 由 `data-nav` 委托层执行跳转 —— 历史上这里是裸 JS 字符串（`location.href=...`）
 * 直接塞进 `onclick` 属性，违反 AGENTS §14.3 零内联事件。
 */
export interface GearMenuOptions {
  user?: {
    email?: string;
    name?: string;
    role?: string;
  };
  basePath?: string;
  lang?: Lang;
  onSettingsClick?: string;
  onLogoutClick?: string;
}

/** 生成标准 5 层紧凑型 ⚙️ 设置下拉菜单 HTML (依据 SYSTEM_UNIFICATION_MASTER_SPEC) */
export function renderGearMenuHtml(options: GearMenuOptions = {}): string {
  const {
    user,
    basePath = "",
    lang = "zh",
    onSettingsClick = "/settings",
    onLogoutClick = "/login?logout=1",
  } = options;

  const isEn = String(lang).startsWith("en");
  const t = getAuthI18n(lang);
  const userDisplay = user?.email || user?.name || (t.topbarUserFallback);

  return `
<div class="gear-wrap" id="gear-wrap">
  <button type="button" class="gear-btn" id="gear-btn" data-action="toggle-gear-menu" title="${t.topbarSettings}" aria-label="Settings">
    ${SettingsIcon}
  </button>
  <div class="gear-menu" id="gear-menu">
    <div class="more-user" title="${escapeHtml(userDisplay)}">${escapeHtml(userDisplay)}</div>
    <button type="button" data-nav="${escapeHtml(onSettingsClick)}">
      <span>⚙️ ${t.topbarSettings}</span>
    </button>
    <button type="button" id="gear-lang-btn" data-action="toggle-language">
      <span>🌐 ${isEn ? t.topbarSwitchToZh : t.topbarSwitchToEn}</span>
    </button>
    <button type="button" id="gear-theme-btn" data-action="toggle-theme">
      <span>🌓 ${t.themeDarkLabel}</span>
    </button>
    <button type="button" class="danger" data-nav="${escapeHtml(onLogoutClick)}">
      <span>🚪 ${t.topbarLogout}</span>
    </button>
  </div>
</div>`;
}

/** 生成标准顶栏右侧平铺操作区 HTML 字符串 */
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

  const isEn = String(lang).startsWith("en");
  const t = getAuthI18n(lang);
  const items: string[] = [];

  // 1. 🌐 语言切换
  if (showLang) {
    items.push(
      `<button type="button" class="icon-btn lang-toggle-btn" data-action="toggle-language" title="${t.topbarLanguage}" aria-label="Toggle Language">${GlobeIcon}</button>`
    );
  }

  // 2. 🌓 主题切换 (三态跟随系统)
  if (showTheme) {
    items.push(
      `<button type="button" class="icon-btn theme-toggle-btn" data-action="toggle-theme" title="${t.topbarTheme}" aria-label="Toggle Theme">${MoonIcon}</button>`
    );
  }

  // 3. 🔔 通知中心 (可选)
  if (showNotifications) {
    const badge = notificationsCount > 0
      ? `<span class="badge-dot">${notificationsCount > 99 ? "99+" : notificationsCount}</span>`
      : "";
    items.push(
      `<button type="button" class="icon-btn notif-btn" data-action="open-notifications" title="${t.topbarNotifications}" aria-label="Notifications">${BellIcon}${badge}</button>`
    );
  }

  // 4. 👤 用户头像/角色 (可选)
  if (user && (user.name || user.email)) {
    const displayName = user.name || user.email?.split("@")[0] || "User";
    const initials = (user.name || displayName).slice(0, 2).toUpperCase();
    const roleTag = user.role ? `<span class="tag role-badge">${escapeHtml(String(user.role))}</span>` : "";
    items.push(
      `<div class="user-chip" title="${escapeHtml(user.email || displayName)}">` +
        `<span class="user-avatar">${escapeHtml(user.avatar || initials)}</span>` +
        `<span class="user-name">${escapeHtml(displayName)}</span>` +
        roleTag +
      `</div>`
    );
  }

  // 5. ⚙ 设置按钮 / 🚪 退出按钮
  if (showSettings) {
    items.push(
      `<button type="button" class="icon-btn settings-btn" data-nav="${escapeHtml(onSettingsClick)}" title="${t.settingsTitle}" aria-label="Settings">${SettingsIcon}</button>`
    );
  }

  if (showLogout) {
    items.push(
      `<button type="button" class="icon-btn logout-btn danger" data-nav="${escapeHtml(onLogoutClick)}" title="${t.topbarLogout}" aria-label="Logout">${LogOutIcon}</button>`
    );
  }

  return `<div class="topbar-actions">${items.join("")}</div>`;
}

/** 注入顶栏 ⚙️ 齿轮菜单交互、主题与多语言切换响应脚本 */
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
    var next = cur === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('theme', next); } catch(e){}
    applyTheme(next);
    var themeBtn = document.getElementById('gear-theme-btn');
    if (themeBtn) {
      themeBtn.innerHTML = '<span>🌓 ' + (next === 'dark' ? '浅色模式' : '深色模式') + '</span>';
    }
    if (typeof toast === 'function') {
      toast(next === 'dark' ? '已切换为深色模式' : '已切换为浅色模式', 's');
    }
  };

  window.toggleLanguage = function() {
    var curLang = document.cookie.match(/lang=([^;]+)/)?.[1] || 'zh';
    var nextLang = curLang.startsWith('en') ? 'zh' : 'en';
    document.cookie = 'lang=' + nextLang + '; Path=/; Max-Age=31536000; SameSite=Lax';
    location.reload();
  };

  window.toggleGearMenu = function(e) {
    if (e) e.stopPropagation();
    var menu = document.getElementById('gear-menu');
    if (menu) menu.classList.toggle('show');
  };

  window.addEventListener('click', function(e) {
    var wrap = document.getElementById('gear-wrap');
    var menu = document.getElementById('gear-menu');
    if (menu && menu.classList.contains('show') && wrap && !wrap.contains(e.target)) {
      menu.classList.remove('show');
    }
  });

  // ── data-action / data-nav 事件委托（AGENTS §14.3 零内联事件）──
  //
  // 此前 gear 菜单与动作组共 10 处 onclick 内联属性。这里统一改为委托转发：
  // 函数仍是 window 上的全局（行为完全兼容），但页面不再依赖内联属性在
  // 特定作用域下可见 —— 那正是历史故障 T-01（内联函数在 IIFE 内未挂到
  // window → ReferenceError 白屏）的成因。
  var ACTIONS = {
    'toggle-theme':   function () { window.toggleTheme(); },
    'toggle-language':function () { window.toggleLanguage(); },
    'toggle-gear-menu':function (el) { window.toggleGearMenu(); },
    'open-notifications': function () {
      if (typeof window.openNotificationsModal === 'function') {
        window.openNotificationsModal();
      } else {
        if (typeof window.toast === 'function') {
          window.toast('通知中心尚未接入', 'w');
        }
      }
    }
  };

  document.addEventListener('click', function (event) {
    var el = event.target && event.target.closest
      ? event.target.closest('[data-action]')
      : null;
    if (el) {
      var fn = ACTIONS[el.getAttribute('data-action')];
      if (fn) { event.preventDefault(); fn(el); return; }
    }
    var nav = event.target && event.target.closest
      ? event.target.closest('[data-nav]')
      : null;
    if (nav) {
      event.preventDefault();
      window.location.href = nav.getAttribute('data-nav');
    }
  });
})();
</script>`;
}

