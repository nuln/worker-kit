/**
 * @nuln/worker-kit/ui/settings-modal
 *
 * 标准 5 大分类系统设置面板生成器。
 * 遵循《SYSTEM_UNIFICATION_MASTER_SPEC.md》第 3 章节：
 * ① 常规与外观 (General & Appearance)
 * ② 认证与安全 (Auth & Security)
 * ③ 存储与备份 (Storage & Backup)
 * ④ 插件与扩展 (Plugins & Extensions)
 * ⑤ 关于与系统 (About & System)
 */

import { SlidersIcon, ShieldIcon, DatabaseIcon, InfoIcon, SettingsIcon } from "./icons.js";
import { getAuthI18n } from "./i18n.js";
import { escapeHtml } from "../http/index.js";
import { safeJsonForScript } from "./script-safety.js";
import type { Lang } from "./i18n.js";

export interface SettingsTabCustomContent {
  generalHtml?: string;
  securityHtml?: string;
  storageHtml?: string;
  pluginsHtml?: string;
  aboutHtml?: string;
}

export interface SettingsModalOptions {
  lang?: Lang;
  modalId?: string;
  serviceName?: string;
  version?: string;
  tabsContent?: SettingsTabCustomContent;
}

export function renderSettingsModalHtml(options: SettingsModalOptions = {}): string {
  const {
    lang = "zh",
    modalId = "settingsModal",
    serviceName = "Service",
    version = "1.0.0",
    tabsContent = {},
  } = options;

  const isEn = (lang as string) === "en-US" || lang === "en";

  // 文案统一来自 AUTH_I18N（AGENTS §2.2）。历史实现在此处有一份局部
  // const t = { … } 8 键字典，与 AUTH_I18N、topbar 的 isEn 三元、
  // modal.ts 的硬编码中文并列为四套并行 i18n 之一。
  const dict = getAuthI18n(lang);
  const t = {
    title: dict.settingsTitle,
    close: dict.settingsClose,
    save: dict.settingsSave,
    tabGeneral: dict.settingsTabGeneral,
    tabSecurity: dict.settingsTabSecurity,
    tabStorage: dict.settingsTabStorage,
    tabPlugins: dict.settingsTabPlugins,
    tabAbout: dict.settingsTabAbout,
  };

  const defaultGeneral = tabsContent.generalHtml || `
    <div class="settings-section">
      <h4>${isEn ? "Interface Appearance" : "界面外观与语言"}</h4>
      <div class="form-row">
        <label>${isEn ? "Language" : "界面语言"}</label>
        <select id="setting-lang" data-setting="language">
          <option value="zh">${isEn ? "Simplified Chinese (简体中文)" : "简体中文 (zh)"}</option>
          <option value="en">${isEn ? "English (EN)" : "English (en)"}</option>
        </select>
      </div>
      <div class="form-row">
        <label>${isEn ? "Theme Mode" : "主题偏好"}</label>
        <select id="setting-theme" data-setting="theme">
          <option value="auto">${isEn ? "Follow System (Auto)" : "跟随系统偏好 (Auto)"}</option>
          <option value="light">${isEn ? "Light" : "浅色明亮"}</option>
          <option value="dark">${isEn ? "Dark" : "深色暗黑"}</option>
        </select>
      </div>
    </div>`;

  const defaultSecurity = tabsContent.securityHtml || `
    <div class="settings-section">
      <h4>${isEn ? "Authentication" : "管理员认证与身份安全"}</h4>
      <p class="muted-hint">${isEn ? "Manage password and OIDC SSO integrations." : "管理登录密码与 OIDC 单点登录集成。"}</p>
      <div id="settings-security-extra"></div>
    </div>`;

  const defaultStorage = tabsContent.storageHtml || `
    <div class="settings-section">
      <h4>${isEn ? "Data & Storage" : "数据备份与清理"}</h4>
      <p class="muted-hint">${isEn ? "Export configuration and trigger retention maintenance." : "导出服务配置快照或执行过期日志清理。"}</p>
      <div id="settings-storage-extra"></div>
    </div>`;

  const defaultPlugins = tabsContent.pluginsHtml || `
    <div class="settings-section">
      <h4>${isEn ? "Active Plugins" : "已加载扩展插件"}</h4>
      <p class="muted-hint">${isEn ? "View and configure plugins for this service." : "查看与管理当前服务已启用的插件。"}</p>
      <div id="settings-plugins-extra"></div>
    </div>`;

  const defaultAbout = tabsContent.aboutHtml || `
    <div class="settings-section">
      <h4>${serviceName}</h4>
      <div class="about-grid">
        <div><span class="muted">${isEn ? "Version" : "版本号"}:</span> <b>v${version}</b></div>
        <div><span class="muted">${isEn ? "Runtime" : "运行环境"}:</span> <b>Cloudflare Workers</b></div>
      </div>
    </div>`;

  return `
<div class="modal modal-backdrop" id="${modalId}" style="display:none;" data-action="settings-close" data-modal-id="${escapeHtml(modalId)}">
  <div class="modal-box settings-modal-box">
    <div class="modal-header">
      <div class="modal-title-wrap">
        <span class="modal-icon">${SettingsIcon}</span>
        <h3 class="modal-title">${t.title}</h3>
      </div>
      <button type="button" class="modal-close-btn" data-action="settings-close" data-modal-id="${escapeHtml(modalId)}" aria-label="${t.close}">✕</button>
    </div>
    <div class="settings-layout">
      <div class="settings-nav">
        <button type="button" class="settings-nav-item active" data-action="settings-tab" data-modal-id="${escapeHtml(modalId)}" data-tab="general">
          ${SettingsIcon} <span>${t.tabGeneral}</span>
        </button>
        <button type="button" class="settings-nav-item" data-action="settings-tab" data-modal-id="${escapeHtml(modalId)}" data-tab="security">
          ${ShieldIcon} <span>${t.tabSecurity}</span>
        </button>
        <button type="button" class="settings-nav-item" data-action="settings-tab" data-modal-id="${escapeHtml(modalId)}" data-tab="storage">
          ${DatabaseIcon} <span>${t.tabStorage}</span>
        </button>
        <button type="button" class="settings-nav-item" data-action="settings-tab" data-modal-id="${escapeHtml(modalId)}" data-tab="plugins">
          ${SlidersIcon} <span>${t.tabPlugins}</span>
        </button>
        <button type="button" class="settings-nav-item" data-action="settings-tab" data-modal-id="${escapeHtml(modalId)}" data-tab="about">
          ${InfoIcon} <span>${t.tabAbout}</span>
        </button>
      </div>
      <div class="settings-content">
        <div class="settings-pane active" id="${modalId}-pane-general">${defaultGeneral}</div>
        <div class="settings-pane" id="${modalId}-pane-security" style="display:none;">${defaultSecurity}</div>
        <div class="settings-pane" id="${modalId}-pane-storage" style="display:none;">${defaultStorage}</div>
        <div class="settings-pane" id="${modalId}-pane-plugins" style="display:none;">${defaultPlugins}</div>
        <div class="settings-pane" id="${modalId}-pane-about" style="display:none;">${defaultAbout}</div>
      </div>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-secondary" data-action="settings-close" data-modal-id="${escapeHtml(modalId)}">${t.close}</button>
    </div>
  </div>
</div>
<script>
/**
 * 设置面板的交互逻辑。
 *
 * ## 为什么整体包在 IIFE 里
 *
 * 历史实现把 switchSettingsTab / openSettingsModal / closeModal 声明在
 * 顶层 script 标签中，因此会创建同名 window 全局。其中 closeModal 与
 * modal.ts 里的 window.closeModal 冲突：每个认证页都会内联 modal.ts
 * （通过 WEBAUTHN_SCRIPT），而 modal.ts 在**点击那一刻**才读取
 * window.closeModal 赋给按钮。若本页脚本后解析，就会覆盖
 * 它，getElementById(undefined) 返回 null —— 于是**所有 alertDlg / confirmDlg
 * 的关闭按钮与遮罩点击全部静默失效**，一层半透明全屏遮罩永久遮挡页面。
 *
 * 现整体包进 IIFE，不泄漏任何全局；面板自身的能力通过
 * window.openSettingsModal 显式导出（不与 modal.ts 冲突）。
 */
(function() {
  function switchSettingsTab(modalId, tabKey, btn) {
    var modal = document.getElementById(modalId);
    if (!modal) return;
    modal.querySelectorAll('.settings-nav-item').forEach(function(b) { b.classList.remove('active'); });
    modal.querySelectorAll('.settings-pane').forEach(function(p) { p.style.display = 'none'; p.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    var pane = document.getElementById(modalId + '-pane-' + tabKey);
    if (pane) {
      pane.style.display = 'block';
      pane.classList.add('active');
    }
  }

  function openSettingsModal(modalId) {
    var id = modalId || ${safeJsonForScript(modalId)};
    var m = document.getElementById(id);
    if (m) m.style.display = 'flex';
  }

  function closeSettingsModal(id) {
    var m = document.getElementById(id);
    if (m) m.style.display = 'none';
  }

  // 显式导出（名字不与 modal.ts 冲突）
  window.openSettingsModal = openSettingsModal;

  // ── data-action 事件委托（AGENTS §14.3 零内联事件）──
  document.addEventListener('click', function (event) {
    var el = event.target && event.target.closest
      ? event.target.closest('[data-action]')
      : null;
    if (!el) return;
    var action = el.getAttribute('data-action');
    var modalId = el.getAttribute('data-modal-id') || ${safeJsonForScript(modalId)};

    if (action === 'settings-close') {
      event.preventDefault();
      closeSettingsModal(modalId);
      return;
    }
    if (action === 'settings-tab') {
      event.preventDefault();
      switchSettingsTab(modalId, el.getAttribute('data-tab'), el);
    }
  });

  // 遮罩点击关闭：仅当点击目标就是遮罩本身时触发
  document.addEventListener('click', function (event) {
    var mask = event.target && event.target.closest
      ? event.target.closest('.modal-backdrop')
      : null;
    if (mask && event.target === mask) {
      closeSettingsModal(mask.getAttribute('id'));
    }
  });

  // ── <select> 变更：data-setting 委托 ──
  document.addEventListener('change', function (event) {
    var el = event.target && event.target.closest
      ? event.target.closest('[data-setting]')
      : null;
    if (!el) return;
    var kind = el.getAttribute('data-setting');
    if (kind === 'language') {
      if (typeof window.setLanguage === 'function') window.setLanguage(el.value);
    } else if (kind === 'theme') {
      try { localStorage.setItem('theme', el.value); } catch (e) {}
      if (typeof window.toggleTheme === 'function') window.toggleTheme();
    }
  });
})();
</script>`;
}
