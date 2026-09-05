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

  const t = {
    title: isEn ? "Settings" : "系统设置",
    close: isEn ? "Close" : "关闭",
    save: isEn ? "Save Changes" : "保存修改",
    tabGeneral: isEn ? "General & Appearance" : "常规与外观",
    tabSecurity: isEn ? "Auth & Security" : "认证与安全",
    tabStorage: isEn ? "Storage & Backup" : "存储与备份",
    tabPlugins: isEn ? "Plugins & Extensions" : "插件与扩展",
    tabAbout: isEn ? "About & System" : "关于与系统",
  };

  const defaultGeneral = tabsContent.generalHtml || `
    <div class="settings-section">
      <h4>${isEn ? "Interface Appearance" : "界面外观与语言"}</h4>
      <div class="form-row">
        <label>${isEn ? "Language" : "界面语言"}</label>
        <select id="setting-lang" onchange="if(window.setLanguage) setLanguage(this.value)">
          <option value="zh">${isEn ? "Simplified Chinese (简体中文)" : "简体中文 (zh)"}</option>
          <option value="en">${isEn ? "English (EN)" : "English (en)"}</option>
        </select>
      </div>
      <div class="form-row">
        <label>${isEn ? "Theme Mode" : "主题偏好"}</label>
        <select id="setting-theme" onchange="if(window.toggleTheme) { localStorage.setItem('theme', this.value); toggleTheme(); }">
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
<div class="modal modal-backdrop" id="${modalId}" style="display:none;" onclick="if(event.target===this) closeModal('${modalId}')">
  <div class="modal-box settings-modal-box">
    <div class="modal-header">
      <div class="modal-title-wrap">
        <span class="modal-icon">${SettingsIcon}</span>
        <h3 class="modal-title">${t.title}</h3>
      </div>
      <button type="button" class="modal-close-btn" onclick="closeModal('${modalId}')" aria-label="${t.close}">✕</button>
    </div>
    <div class="settings-layout">
      <div class="settings-nav">
        <button type="button" class="settings-nav-item active" onclick="switchSettingsTab('${modalId}', 'general', this)">
          ${SettingsIcon} <span>${t.tabGeneral}</span>
        </button>
        <button type="button" class="settings-nav-item" onclick="switchSettingsTab('${modalId}', 'security', this)">
          ${ShieldIcon} <span>${t.tabSecurity}</span>
        </button>
        <button type="button" class="settings-nav-item" onclick="switchSettingsTab('${modalId}', 'storage', this)">
          ${DatabaseIcon} <span>${t.tabStorage}</span>
        </button>
        <button type="button" class="settings-nav-item" onclick="switchSettingsTab('${modalId}', 'plugins', this)">
          ${SlidersIcon} <span>${t.tabPlugins}</span>
        </button>
        <button type="button" class="settings-nav-item" onclick="switchSettingsTab('${modalId}', 'about', this)">
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
      <button type="button" class="btn btn-secondary" onclick="closeModal('${modalId}')">${t.close}</button>
    </div>
  </div>
</div>
<script>
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
  var id = modalId || '${modalId}';
  var m = document.getElementById(id);
  if (m) m.style.display = 'flex';
}
function closeModal(id) {
  var m = document.getElementById(id);
  if (m) m.style.display = 'none';
}
</script>`;
}
