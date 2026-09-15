/**
 * OIDC 身份平台统一现代 UI 样式系统（Nuln Design System · 灰白极简 / Charcoal Slate）
 * - 980px 统一居中版心，支持系统浅色/深色自适应（prefers-color-scheme）
 * - 原生顶栏：品牌 + 页内 Tab（客户端/用户/分组）+ 设置齿轮
 * - 现代化卡片、指标统计卡片网格、数据表格、徽章、模态弹窗与 Toast
 * 与工作区根目录 design-system-template.css 的 Design Tokens 严格对齐。
 */

import { MODAL_CSS } from "./modal.js";

export const DESIGN_TOKENS = `
  :root {
    color-scheme: light;
    --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;

    --bg-canvas: #f8f9fa;
    --bg-surface: #ffffff;
    --bg-surface-elevated: #ffffff;
    --bg-subtle: #f1f3f5;
    --bg-hover: #e9ecef;
    --bg-active: #dee2e6;

    --border-subtle: #edf0f2;
    --border-base: #e2e5e9;
    --border-strong: #c8cdd4;

    --text-primary: #111418;
    --text-secondary: #505967;
    --text-tertiary: #8a93a0;
    --text-disabled: #c2c8d1;

    --primary: #111418;
    --primary-hover: #1e232b;
    --primary-light: #f1f3f5;
    --primary-border: #d0d5dc;
    --primary-text: #111418;
    --primary-contrast: #ffffff;
    --primary-ring: rgba(17, 20, 24, 0.12);

    --success: #16a34a;
    --success-light: #f0fdf4;
    --success-border: #bbf7d0;
    --success-text: #15803d;
    --warning: #ca8a04;
    --warning-light: #fefce8;
    --warning-border: #fef08a;
    --warning-text: #854d0e;
    --danger: #dc2626;
    --danger-light: #fef2f2;
    --danger-border: #fecaca;
    --danger-text: #b91c1b;

    --neutral-badge-bg: #f1f3f5;
    --neutral-badge-border: #e2e5e9;
    --neutral-badge-text: #414853;

    --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.03);
    --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02);
    --shadow-md: 0 4px 12px -2px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.02);
    --shadow-lg: 0 10px 25px -4px rgba(0, 0, 0, 0.07), 0 4px 8px -2px rgba(0, 0, 0, 0.03);
    --shadow-modal: 0 20px 40px -10px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.06);

    --radius-sm: 6px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --radius-full: 9999px;

    --transition-fast: 0.12s cubic-bezier(0.4, 0, 0.2, 1);
    --transition-normal: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }
  [data-theme="dark"] {
    color-scheme: dark;
    --bg-canvas: #0c0e12;
    --bg-surface: #14171d;
    --bg-surface-elevated: #1b1f26;
    --bg-subtle: #191d24;
    --bg-hover: #222731;
    --bg-active: #2a313d;

    --border-subtle: #1e232b;
    --border-base: #272d37;
    --border-strong: #38414e;

    --text-primary: #f0f3f6;
    --text-secondary: #9aa3af;
    --text-tertiary: #677180;
    --text-disabled: #464e59;

    --primary: #f0f3f6;
    --primary-hover: #ffffff;
    --primary-light: rgba(255, 255, 255, 0.08);
    --primary-border: rgba(255, 255, 255, 0.18);
    --primary-text: #f0f3f6;
    --primary-contrast: #0c0e12;
    --primary-ring: rgba(255, 255, 255, 0.15);

    --success: #22c55e;
    --success-light: rgba(34, 197, 94, 0.1);
    --success-border: rgba(34, 197, 94, 0.2);
    --success-text: #86efac;
    --warning: #eab308;
    --warning-light: rgba(234, 179, 8, 0.1);
    --warning-border: rgba(234, 179, 8, 0.2);
    --warning-text: #fde047;
    --danger: #ef4444;
    --danger-light: rgba(239, 68, 68, 0.1);
    --danger-border: rgba(239, 68, 68, 0.2);
    --danger-text: #fca5a5;

    --neutral-badge-bg: rgba(255, 255, 255, 0.06);
    --neutral-badge-border: rgba(255, 255, 255, 0.12);
    --neutral-badge-text: #d0d5dc;

    --shadow-xs: none;
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
    --shadow-md: 0 4px 14px rgba(0, 0, 0, 0.4);
    --shadow-lg: 0 12px 30px rgba(0, 0, 0, 0.5);
    --shadow-modal: 0 24px 48px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.08);
  }
  /* 纯 CSS 系统深色兜底：无内联脚本的页面（如 Tower 登录页）也能跟随系统深色 */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --bg-canvas: #0c0e12;
      --bg-surface: #14171d;
      --bg-surface-elevated: #1b1f26;
      --bg-subtle: #191d24;
      --bg-hover: #222731;
      --bg-active: #2a313d;

      --border-subtle: #1e232b;
      --border-base: #272d37;
      --border-strong: #38414e;

      --text-primary: #f0f3f6;
      --text-secondary: #9aa3af;
      --text-tertiary: #677180;
      --text-disabled: #464e59;

      --primary: #f0f3f6;
      --primary-hover: #ffffff;
      --primary-light: rgba(255, 255, 255, 0.08);
      --primary-border: rgba(255, 255, 255, 0.18);
      --primary-text: #f0f3f6;
      --primary-contrast: #0c0e12;
      --primary-ring: rgba(255, 255, 255, 0.15);

      --success: #22c55e;
      --success-light: rgba(34, 197, 94, 0.1);
      --success-border: rgba(34, 197, 94, 0.2);
      --success-text: #86efac;
      --warning: #eab308;
      --warning-light: rgba(234, 179, 8, 0.1);
      --warning-border: rgba(234, 179, 8, 0.2);
      --warning-text: #fde047;
      --danger: #ef4444;
      --danger-light: rgba(239, 68, 68, 0.1);
      --danger-border: rgba(239, 68, 68, 0.2);
      --danger-text: #fca5a5;

      --neutral-badge-bg: rgba(255, 255, 255, 0.06);
      --neutral-badge-border: rgba(255, 255, 255, 0.12);
      --neutral-badge-text: #d0d5dc;

      --shadow-xs: none;
      --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
      --shadow-md: 0 4px 14px rgba(0, 0, 0, 0.4);
      --shadow-lg: 0 12px 30px rgba(0, 0, 0, 0.5);
      --shadow-modal: 0 24px 48px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.08);
    }
  }
`;

export const BASE_RULES = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: var(--font-sans);
    font-size: 13.5px;
    line-height: 1.5;
    background: var(--bg-canvas);
    color: var(--text-primary);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  main {
    max-width: 100%;
    width: 100%;
    margin: 0;
    padding: 12px 12px 60px;
    box-sizing: border-box;
  }
  h1 { font-size: 20px; font-weight: 700; margin: 0 0 8px; color: var(--text-primary); }
  h2 { font-size: 16px; font-weight: 600; margin: 0; color: var(--text-primary); }
  h3 { font-size: 15px; font-weight: 600; margin: 0; color: var(--text-primary); }
  p { margin: 0.35rem 0; line-height: 1.5; }
  a { color: var(--text-primary); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code {
    font-family: var(--font-mono);
    font-size: 12px;
    background: var(--bg-subtle);
    border: 1px solid var(--border-subtle);
    padding: 1px 5px;
    border-radius: 4px;
    color: var(--text-secondary);
  }
`;

export const TOPBAR_RULES = `
  /* 统一顶栏 (Topbar) — 全屏通栏顶格 */
  .topbar {
    position: sticky;
    top: 0;
    z-index: 40;
    max-width: 100%;
    width: 100%;
    margin: 0;
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border-base);
    border-top: none;
    border-left: none;
    border-right: none;
    border-radius: 0;
    box-shadow: var(--shadow-xs);
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 48px;
    padding: 0 14px;
    box-sizing: border-box;
  }
  .topbar .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 650;
    font-size: 14.5px;
    letter-spacing: -0.2px;
    color: var(--text-primary);
    user-select: none;
  }
  .topbar .brand .tag.pub {
    font-size: 11px;
    font-weight: 500;
    background: var(--bg-subtle);
    color: var(--text-secondary);
    padding: 1px 6px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border-base);
  }

  /* 顶栏页内 Tab 菜单（客户端 / 用户 / 分组） */
  .topbar .menu { display: flex; gap: 4px; margin-left: 10px; }
  .topbar .menu button {
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 500;
    padding: 5px 12px;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-fast);
  }
  .topbar .menu button:hover { background: var(--bg-hover); color: var(--text-primary); }
  .topbar .menu button.act {
    background: var(--bg-surface);
    color: var(--text-primary);
    border-color: var(--border-base);
    font-weight: 600;
    box-shadow: var(--shadow-xs);
  }
  .topbar .actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }

  /* 下拉菜单 (Gear / More) */
  .gear-wrap, .more { position: relative; display: inline-flex; align-items: center; vertical-align: middle; }
  .icon-btn, .lang-toggle-btn, .theme-toggle-btn, button.gear, .more > button {
    width: 32px;
    height: 32px;
    min-width: 32px;
    min-height: 32px;
    max-width: 32px;
    max-height: 32px;
    padding: 0;
    margin: 0;
    border: 1px solid var(--border-base);
    border-radius: var(--radius-md, 6px);
    background: var(--bg-surface);
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow: none;
    transition: var(--transition-fast);
    outline: none !important;
    box-sizing: border-box;
    -webkit-appearance: none;
    appearance: none;
  }
  .icon-btn:hover, .lang-toggle-btn:hover, .theme-toggle-btn:hover, button.gear:hover, .more > button:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-strong, var(--border-base));
  }
  .icon-btn:focus, .lang-toggle-btn:focus, .theme-toggle-btn:focus, button.gear:focus, .more > button:focus,
  .icon-btn:focus-visible, .lang-toggle-btn:focus-visible, .theme-toggle-btn:focus-visible, button.gear:focus-visible, .more > button:focus-visible {
    outline: none !important;
    box-shadow: none !important;
  }
  .icon-btn svg, .lang-toggle-btn svg, .theme-toggle-btn svg, button.gear svg, .more > button svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    display: block;
    pointer-events: none;
  }
  .gear-menu, .more-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    background: var(--bg-surface);
    border: 1px solid var(--border-base);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    width: max-content;
    min-width: 105px;
    max-width: 160px;
    padding: 4px;
    display: none;
    flex-direction: column;
    gap: 2px;
    z-index: 1000;
    box-sizing: border-box;
    color: var(--text-primary);
    animation: modalIn .15s ease-out;
  }
  .gear-menu.open, .gear-menu.show, .more-menu.open, .more.open .more-menu, .gear-wrap.open .gear-menu { display: flex; }
  .gear-menu button, .more-menu button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    text-align: center;
    border: none;
    background: transparent;
    padding: 6px 10px;
    margin: 0;
    border-radius: var(--radius-sm);
    font-size: 12px;
    white-space: nowrap;
    color: var(--text-primary);
    cursor: pointer;
    box-sizing: border-box;
    transition: background .12s, color .12s;
  }
  .gear-menu button:hover, .more-menu button:hover { background: var(--bg-hover); color: var(--text-primary); }
  .gear-menu button.danger, .gear-menu button.danger-t, .more-menu button.danger { color: var(--danger); }
  .gear-menu button.danger:hover, .gear-menu button.danger-t:hover, .more-menu button.danger:hover { background: var(--danger-light); color: var(--danger-text); }
  .gear-divider {
    height: 1px;
    background: var(--border-base);
    margin: 3px 0;
  }
  .mobile-nav-btn {
    display: none !important;
  }
  .more-user {
    display: block;
    padding: 6px 8px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-tertiary);
    text-align: center;
    border-bottom: 1px solid var(--border-base);
    margin-bottom: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: none;
  }
`;

const CONTENT_RULES = `
  /* 页面标题区 */
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 4px;
  }
  .page-title { font-size: 19px; font-weight: 650; letter-spacing: -0.3px; color: var(--text-primary); }
  .page-desc { font-size: 12.5px; color: var(--text-secondary); margin-top: 2px; }

  /* 指标统计卡片网格 */
  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 12px;
    margin-bottom: 20px;
  }
  .metric-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-base);
    border-radius: var(--radius-md);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    box-shadow: var(--shadow-xs);
    transition: var(--transition-fast);
  }
  .metric-card:hover { border-color: var(--border-strong); transform: translateY(-1px); }
  .metric-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .metric-value { font-size: 22px; font-weight: 650; letter-spacing: -0.4px; color: var(--text-primary); }
  .metric-trend { font-size: 11px; display: flex; align-items: center; gap: 4px; font-weight: 500; }
  .trend-up { color: var(--success-text); }
  .trend-neutral { color: var(--text-tertiary); }

  /* 卡片容器 */
  .card {
    background: var(--bg-surface);
    border: 1px solid var(--border-base);
    border-radius: var(--radius-md);
    padding: 12px 14px;
    margin-bottom: 8px;
    box-shadow: var(--shadow-xs);
  }
  .card-panel {
    background: var(--bg-surface);
    border: 1px solid var(--border-base);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-xs);
    overflow: hidden;
    margin-bottom: 8px;
  }
  .card + .card, .card-panel + .card-panel, .card + .card-panel, .card-panel + .card {
    margin-top: 8px;
  }
  .panel-header {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-base);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .panel-title { font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
  .panel-desc { font-size: 11px; color: var(--text-tertiary); }

  /* 应用/网站卡片网格 (App Grid) */
  .app-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 8px;
    margin-top: 6px;
  }
  .app-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-base);
    border-radius: var(--radius-md);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 6px;
    box-shadow: var(--shadow-xs);
    transition: var(--transition-fast);
  }
  .app-card:hover {
    border-color: var(--border-strong);
    box-shadow: var(--shadow-sm);
  }
  .app-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }
  .app-card-main {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    flex: 1;
  }
  .app-card-info {
    min-width: 0;
    flex: 1;
    overflow: hidden;
  }
  .app-card-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.3;
  }
  .app-card-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding-top: 4px;
    border-top: 1px solid var(--border-subtle);
  }
  .app-card-tags {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    min-width: 0;
  }
  .app-card-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
  }
  .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .bar {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 8px;
    gap: 8px;
  }
  .bar > div:first-child, .bar > h1, .bar > h2, .bar > h3 {
    flex: 1;
    min-width: 0;
  }
  .bar > button, .bar > .bar-actions, .bar > a.btn, .bar > a {
    flex-shrink: 0;
    white-space: nowrap;
    align-self: flex-start;
  }
  .sub-tabs {
    display: inline-flex;
    align-items: center;
    background: var(--bg-subtle);
    padding: 2px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-base);
    gap: 2px;
  }
  .sub-tab {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 500;
    padding: 4px 10px;
    border-radius: calc(var(--radius-md) - 2px);
    cursor: pointer;
    transition: var(--transition-fast);
    line-height: 1.3;
    outline: none;
  }
  .sub-tab:hover {
    color: var(--text-primary);
  }
  .sub-tab.act {
    background: var(--bg-surface);
    color: var(--text-primary);
    font-weight: 600;
    box-shadow: var(--shadow-xs);
  }
  .divider { border-top: 1px solid var(--border-base); margin: 10px 0; }

  /* 设置双列流式布局：紧凑间距 */
  .settings-layout {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
    width: 100%;
    box-sizing: border-box;
  }
  .settings-col {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
  }
  @media (min-width: 860px) {
    .settings-layout {
      display: grid !important;
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      gap: 12px !important;
      align-items: start !important;
    }
  }

  /* 环境配置中心现代化属性列表 */
  .config-list {
    display: flex;
    flex-direction: column;
  }
  .config-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border-subtle);
  }
  .config-item:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
  .config-item:first-child {
    padding-top: 0;
  }
  .config-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1 1 auto;
  }
  .config-label {
    display: flex;
    align-items: center;
    gap: 5px;
    line-height: 1.3;
  }
  .config-title {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .config-key {
    font-size: 10.5px;
    color: var(--text-tertiary);
    font-family: var(--font-mono);
  }
  .config-val-group {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    text-align: right;
    justify-content: flex-end;
  }
  .config-val {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-primary);
    background: var(--bg-subtle);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
  }
  .config-val.empty {
    background: transparent;
    border: none;
    padding: 0;
    color: var(--text-tertiary);
    font-style: italic;
    font-family: inherit;
    font-size: 11.5px;
  }
  @media (max-width: 580px) {
    .config-item {
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
    }
    .config-val-group {
      width: 100%;
      justify-content: space-between;
    }
    .config-val {
      max-width: 100%;
      text-align: left;
    }
  }

  /* 浮窗提示与帮助图标按钮 */
  .tip-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    margin: 0;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    border-radius: 50%;
    cursor: pointer;
    vertical-align: middle;
    transition: color 0.15s, background 0.15s;
    line-height: 1;
    flex-shrink: 0;
  }
  .tip-btn:hover, .tip-btn:focus {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .tip-btn svg {
    width: 13px;
    height: 13px;
    display: block;
    pointer-events: none;
  }
  .popover-tip {
    position: fixed;
    z-index: 1000;
    background: var(--bg-surface);
    border: 1px solid var(--border-base);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
    padding: 10px 14px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-primary);
    max-width: min(320px, 90vw);
    pointer-events: auto;
    box-sizing: border-box;
  }

  /* 概览统计条（兼容旧结构） */
  .stats-summary { display: flex; gap: 24px; padding: 4px 0; align-items: center; flex-wrap: wrap; }
  .stats-item { font-size: 13px; color: var(--text-tertiary); display: flex; align-items: center; gap: 6px; }
  .stats-item strong { color: var(--text-primary); font-size: 16px; font-weight: 700; }

  /* 选项卡导航 */
  .tab-nav-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--border-base);
    margin-top: 4px;
  }
  .tab-list { display: flex; gap: 4px; }
  .tab-btn {
    padding: 7px 13px;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
    background: transparent;
    border: none;
    cursor: pointer;
    position: relative;
    transition: var(--transition-fast);
  }
  .tab-btn:hover { color: var(--text-primary); background: var(--bg-hover); }
  .tab-btn.active { color: var(--text-primary); font-weight: 600; }
  .tab-btn.active::after {
    content: "";
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--text-primary);
    border-radius: 2px;
  }

  /* 现代表格系统 */
  .data-table-wrap { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .data-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 12.5px; }
  .data-table th {
    background: var(--bg-subtle);
    color: var(--text-secondary);
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 9px 16px;
    border-bottom: 1px solid var(--border-base);
    white-space: nowrap;
  }
  .data-table td {
    padding: 11px 16px;
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text-primary);
    vertical-align: middle;
    word-break: normal;
  }
  .data-table tr:hover td { background: var(--bg-hover); }
  .data-table tr:last-child td { border-bottom: none; }
  .data-table .cell-actions { text-align: right; white-space: nowrap; }

  /* 通用表格（兼容） */
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 6px 0; }
  th, td { text-align: left; padding: 10px 10px; border-bottom: 1px solid var(--border-subtle); vertical-align: middle; }
  th { color: var(--text-secondary); font-weight: 600; font-size: 12px; letter-spacing: .3px; }
  td { word-break: normal; }
  tbody tr:hover { background: var(--bg-hover); }
  th:last-child, td:last-child { text-align: right; }
`;

const FORM_RULES = `
  /* 表单与输入控件 */
  input:not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=hidden]):not([type=file]),
  select,
  textarea {
    font-family: inherit;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-primary);
    background: var(--bg-subtle);
    border: 1px solid var(--border-base);
    border-radius: var(--radius-md);
    padding: 7px 11px;
    width: 100%;
    box-sizing: border-box;
    transition: border-color .15s ease, box-shadow .15s ease, background-color .15s ease;
  }
  input:not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=hidden]):not([type=file]):hover,
  select:hover,
  textarea:hover { border-color: var(--border-strong); }
  input:not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=hidden]):not([type=file]):focus,
  select:focus,
  textarea:focus {
    outline: none;
    background: var(--bg-surface);
    border-color: var(--text-primary);
    box-shadow: 0 0 0 2px var(--primary-ring);
  }
  input::placeholder, textarea::placeholder { color: var(--text-tertiary); }
  textarea { resize: vertical; min-height: 80px; font-family: var(--font-mono); }
  label.check {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 13px;
    color: inherit;
    font-weight: 500;
    margin: 12px 0 0;
    cursor: pointer;
    line-height: 1.4;
  }
  label.check input[type=checkbox] {
    width: 16px;
    height: 16px;
    margin: 2px 0 0;
    flex: none;
    accent-color: var(--text-primary);
    cursor: pointer;
  }
  label.check .check-content,
  label.check .check-text,
  label.check .check-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1 1 auto;
    min-width: 0;
  }

  .form-input {
    height: 32px;
    background: var(--bg-subtle);
    border: 1px solid var(--border-base);
    border-radius: var(--radius-md);
    padding: 0 10px;
    font-size: 12.5px;
    color: var(--text-primary);
    outline: none;
    font-family: inherit;
    transition: var(--transition-fast);
  }
  .form-input:focus { background: var(--bg-surface); border-color: var(--text-primary); box-shadow: 0 0 0 2px var(--primary-ring); }
  .form-fld { display: flex; flex-direction: column; gap: 4px; }
  .form-fld label { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
  .form-fld .hint { font-size: 11px; color: var(--text-tertiary); }

  .fld { display: flex; flex-direction: column; gap: 4px; width: 100%; max-width: 100%; box-sizing: border-box; }
  .fld label { margin: 0 0 2px; }
  .fld input, .fld select, .fld textarea { width: 100%; margin: 0; }
  .fld > .hint { font-size: 12px; color: var(--text-tertiary); line-height: 1.4; margin-top: 4px; }
  .form-grid { display: flex; gap: 12px; flex-wrap: wrap; width: 100%; }
  .form-grid > .fld { flex: 1 1 200px; width: auto; }
  .inset { background: var(--bg-subtle); border: 1px solid var(--border-base); border-radius: var(--radius-md); padding: 16px 18px; }
  .inset .bar { margin-bottom: 12px; }

  /* 按钮系统 */
  button, .btn {
    padding: 6px 13px;
    border: 1px solid var(--border-base);
    background: var(--bg-surface);
    color: var(--text-primary);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: 12.5px;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: var(--transition-fast);
    text-decoration: none;
    font-family: inherit;
    white-space: nowrap;
  }
  button:hover, .btn:hover { background: var(--bg-hover); border-color: var(--border-strong); color: var(--text-primary); }
  button.primary, .btn.primary, button[type="submit"], input[type="submit"] { background: var(--primary); border-color: var(--primary); color: var(--primary-contrast); }
  button.primary:hover, .btn.primary:hover { background: var(--primary-hover); border-color: var(--primary-hover); color: var(--primary-contrast); box-shadow: var(--shadow-xs); }
  button.danger, .btn.danger { color: var(--danger-text); border-color: var(--danger-border); background: var(--danger-light); }
  button.danger:hover, .btn.danger:hover { background: var(--danger-light); border-color: var(--danger); }
  button.green, .btn.green { color: var(--success-text); border-color: var(--success-border); background: var(--success-light); }
  button.green:hover, .btn.green:hover { background: var(--success-light); border-color: var(--success); }
  button.ghost, .btn.ghost { background: transparent; border-color: transparent; color: var(--text-secondary); }
  button.ghost:hover, .btn.ghost:hover { background: var(--bg-hover); color: var(--text-primary); }
  button.sm, .btn.sm { padding: 4px 9px; font-size: 11.5px; border-radius: var(--radius-sm); }
  button:disabled, .btn:disabled { opacity: .5; cursor: not-allowed; }
  .icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; border-radius: var(--radius-md); }
`;

const BADGE_RULES = `
  /* 状态与协议徽章（中性灰微底色 + 微圆点指示灯） */
  .tag, .badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 1px 7px;
    border-radius: var(--radius-full);
    font-size: 10.5px;
    font-weight: 500;
    white-space: nowrap;
    background: var(--neutral-badge-bg);
    color: var(--neutral-badge-text);
    border: 1px solid var(--neutral-badge-border);
  }
  .badge-dot { width: 5px; height: 5px; border-radius: var(--radius-full); background: var(--success); }
  .tag.on, .badge.on { background: var(--success-light); color: var(--success-text); border-color: var(--success-border); }
  .tag.off, .badge.off { background: var(--danger-light); color: var(--danger-text); border-color: var(--danger-border); }
  .tag.pub, .badge.pub { background: var(--bg-subtle); color: var(--text-secondary); border-color: var(--border-base); }
  .tag.muted, .badge.muted { background: var(--bg-subtle); color: var(--text-tertiary); border-color: var(--border-subtle); }
  .tag.tpl { background: var(--warning-light); color: var(--warning-text); border-color: var(--warning-border); }
  .tag.warn, .badge.warn { background: var(--warning-light); color: var(--warning-text); border-color: var(--warning-border); }
  .tag.info, .badge.info { background: var(--primary-light); color: var(--text-primary); border-color: var(--border-base); }
  .chip {
    display: inline-flex;
    align-items: center;
    padding: 2px 9px;
    margin: 2px 4px 2px 0;
    border-radius: var(--radius-full);
    font-size: 11.5px;
    background: var(--neutral-badge-bg);
    color: var(--neutral-badge-text);
    font-weight: 500;
    border: 1px solid var(--neutral-badge-border);
  }
  .code-pill {
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--bg-subtle);
    border: 1px solid var(--border-subtle);
    padding: 2px 6px;
    border-radius: 4px;
    color: var(--text-secondary);
  }
  .muted { color: var(--text-secondary); font-size: 13px; }
  .empty { text-align: center; padding: 36px 12px; color: var(--text-tertiary); font-size: 13px; }
`;

const MODAL_TOAST_RULES = MODAL_CSS;

const SEARCH_RULES = `
  /* 搜索框 */
  .search-bar { display: flex; gap: 8px; margin-bottom: 12px; }
  .search-bar input { flex: 1; }
`;

export const LANG_RULES = `
  /* 极简统一语言与主题切换图标按钮 */
  .lang-toggle-btn, .theme-toggle-btn {
    width: 32px;
    height: 32px;
    padding: 0;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-base);
    background: var(--bg-surface);
    color: var(--text-secondary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: var(--transition-fast);
    font-family: inherit;
    text-decoration: none;
    box-sizing: border-box;
    user-select: none;
    flex-shrink: 0;
  }
  .lang-toggle-btn svg, .theme-toggle-btn svg {
    width: 16px;
    height: 16px;
    display: block;
    pointer-events: none;
  }
  .lang-toggle-btn:hover, .theme-toggle-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-strong);
  }
  /* 登录/认证页面右上角圆形定位 */
  .lang-toggle-wrap {
    position: fixed;
    right: 18px;
    top: 18px;
    z-index: 200;
    display: inline-flex;
    gap: 6px;
    align-items: center;
    margin: 0;
    padding: 0;
  }
  .lang-toggle-wrap .lang-toggle-btn, .lang-toggle-wrap .theme-toggle-btn {
    box-shadow: var(--shadow-sm);
    margin: 0;
  }
`;

const RESPONSIVE_RULES = `
  /* =========================================================
     移动端与窄屏响应式系统 (@media max-width: 640px)
     ========================================================= */
  @media (max-width: 640px) {
    body { font-size: 13px; }
    main { padding: 8px 8px 60px; }
    .topbar { padding: 0 10px; height: 46px; }
    .topbar .brand { gap: 6px; font-size: 13.5px; }
    .topbar .brand span.brand-text { font-size: 13.5px; }
    /* 移动端顶栏 Tab 隐藏，独立菜单图标浮窗显示 */
    .topbar .menu { display: none !important; }
    .mobile-nav-btn { display: inline-flex !important; }
    .card { padding: 12px 12px; border-radius: var(--radius-md); margin-bottom: 10px; }
    .card + .card, .card-panel + .card-panel, .card + .card-panel, .card-panel + .card { margin-top: 10px; }
    .card .bar { margin-bottom: 10px; gap: 8px; }
    .card .bar h2 { font-size: 14.5px; }
    .search-bar { margin-bottom: 8px; }
    .search-bar input { font-size: 12px; padding: 6px 9px; }
    .data-table-wrap { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .data-table { font-size: 12px; width: 100%; }
    .data-table th, .data-table td { padding: 8px 8px; white-space: nowrap; }
    .hide-sm { display: none !important; }
    .data-table td button { padding: 3px 6px; font-size: 11px; margin-right: 2px; }
    .app-grid { grid-template-columns: 1fr; gap: 8px; }
  }

  @media (max-width: 960px) {
    .hide-md { display: none !important; }
  }
`;

export const PAGE_STYLE = [
  DESIGN_TOKENS,
  BASE_RULES,
  TOPBAR_RULES,
  CONTENT_RULES,
  FORM_RULES,
  BADGE_RULES,
  SEARCH_RULES,
  MODAL_TOAST_RULES,
  RESPONSIVE_RULES,
  LANG_RULES,
].join("\n");

/**
 * 居中独立认证卡片样式系统（/login, /register, /recover, /setup, /device, /authorize）
 * 炭黑主按钮、居中独立卡片、低饱和提示文案
 */
export const AUTH_STYLE = [
  DESIGN_TOKENS,
  `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: var(--font-sans);
    margin: 0;
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
    background: var(--bg-canvas);
    color: var(--text-primary);
    -webkit-font-smoothing: antialiased;
  }
  .auth-wrap { width: 100%; max-width: 310px; margin: 0 auto; box-sizing: border-box; }
  .capsule-header {
    display: flex;
    justify-content: center;
    margin-bottom: 20px;
  }
  .capsule-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px 4px 6px;
    background: var(--bg-subtle);
    border: 1px solid var(--border-base);
    border-radius: var(--radius-full);
    font-size: 13.5px;
    font-weight: 650;
    color: var(--text-primary);
    user-select: none;
  }
  .capsule-icon {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--primary);
    color: var(--primary-contrast);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 800;
    flex-shrink: 0;
  }
  .capsule-icon svg {
    width: 12px;
    height: 12px;
  }
  .card {
    background: var(--bg-surface);
    border: 1px solid var(--border-base);
    border-radius: var(--radius-lg);
    padding: 24px 22px 18px;
    width: 100%;
    box-shadow: var(--shadow-sm);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }
  .card + .card {
    margin-top: 14px;
  }
  .client-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: var(--bg-subtle);
    border: 1px solid var(--border-base);
    border-radius: var(--radius-md);
    margin: 14px 0 12px;
    box-sizing: border-box;
  }
  .client-icon-box {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
    box-shadow: var(--shadow-xs);
  }
  .client-icon-img {
    width: 28px;
    height: 28px;
    object-fit: contain;
  }
  .client-icon-fallback {
    font-size: 20px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--text-secondary);
  }
  .client-card-text {
    flex: 1;
    min-width: 0;
    text-align: left;
  }
  .client-card-title {
    font-weight: 700;
    font-size: 13.5px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .client-card-sub {
    font-size: 12px;
    color: var(--text-tertiary);
    margin-top: 2px;
    line-height: 1.3;
  }
  .user-identity-box {
    background: var(--bg-subtle);
    border: 1px solid var(--border-base);
    border-radius: var(--radius-md);
    padding: 10px 14px;
    margin-bottom: 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    box-sizing: border-box;
  }
  .user-identity-icon {
    font-size: 16px;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .user-identity-label {
    font-size: 11px;
    color: var(--text-tertiary);
    margin-bottom: 1px;
    font-weight: 500;
  }
  .user-identity-email {
    font-size: 13px;
    font-weight: 650;
    color: var(--text-primary);
    word-break: break-all;
  }
  h1 { font-size: 20px; font-weight: 700; text-align: center; margin: 0 0 6px; color: var(--text-primary); letter-spacing: -0.02em; }
  p { margin: .4rem 0; line-height: 1.5; font-size: 13px; }
  .sub { text-align: center; color: var(--text-tertiary); font-size: 12.5px; margin: 0 0 18px; }
  .muted { color: var(--text-secondary); font-size: 12.5px; }
  a { color: var(--text-secondary); text-decoration: none; font-weight: 500; transition: color .15s; }
  a:hover { color: var(--text-primary); text-decoration: underline; }
  .auth-links {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--border-subtle);
    font-size: 12px;
  }

  .input-field {
    position: relative;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    width: 100%;
  }

  input:not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=hidden]):not([type=file]),
  select,
  textarea {
    font: inherit;
    font-size: 13px;
    color: var(--text-primary);
    width: 100%;
    height: 38px;
    padding: 0 12px;
    margin: 0 0 10px 0;
    border: 1px solid var(--border-base);
    border-radius: var(--radius-sm);
    background: var(--bg-subtle);
    box-sizing: border-box;
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  }
  input:not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=hidden]):not([type=file]):hover,
  select:hover,
  textarea:hover { border-color: var(--border-strong); }
  input:not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=hidden]):not([type=file]):focus,
  select:focus,
  textarea:focus {
    outline: none;
    background: var(--bg-surface);
    border-color: var(--primary);
    box-shadow: 0 0 0 2px var(--primary-ring);
  }
  input::placeholder, textarea::placeholder { color: var(--text-tertiary); font-size: 12.5px; }
  label { display: block; font-size: 12px; color: var(--text-secondary); font-weight: 550; margin: 4px 0 4px; }

  .btn {
    font: inherit;
    font-weight: 600;
    font-size: 13px;
    width: 100%;
    height: 38px;
    padding: 0 16px;
    margin: 0;
    border: 1px solid var(--primary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    background: var(--primary);
    color: var(--primary-contrast);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: var(--transition-fast);
    text-decoration: none;
    box-sizing: border-box;
  }
  .btn:hover { background: var(--primary-hover); border-color: var(--primary-hover); color: var(--primary-contrast); }
  .btn:disabled { opacity: .55; cursor: not-allowed; }
  .btn.secondary { background: var(--bg-subtle); color: var(--text-primary); border-color: var(--border-base); }
  .btn.secondary:hover { background: var(--bg-hover); color: var(--text-primary); border-color: var(--border-strong); }
  .btn.danger { background: var(--danger-light); color: var(--danger-text); border-color: var(--danger-border); }
  .btn.danger:hover { background: var(--danger-light); border-color: var(--danger); }
  .btn.green { background: var(--success); border-color: var(--success); color: #ffffff; }
  .btn.green:hover { background: var(--success-text); border-color: var(--success-text); }
  .divider { border-top: 1px solid var(--border-base); margin: 16px 0; }
  p.msg { color: var(--danger-text); font-size: 13px; min-height: 18px; margin: 8px 0 0; }
  p.hint { color: var(--text-secondary); font-size: 13px; margin: 0 0 12px; }

  .chip {
    display: inline-flex;
    align-items: center;
    padding: 2px 9px;
    margin: 2px 4px 2px 0;
    border-radius: var(--radius-full);
    font-size: 12px;
    background: var(--neutral-badge-bg);
    color: var(--neutral-badge-text);
    font-weight: 500;
    border: 1px solid var(--neutral-badge-border);
  }
  .tag {
    display: inline-block;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    font-size: 12px;
    font-weight: 500;
  }
  .tag.on { background: var(--success-light); color: var(--success-text); border: 1px solid var(--success-border); }
  .tag.off { background: var(--danger-light); color: var(--danger-text); border: 1px solid var(--danger-border); }
  .tag.warn { background: var(--warning-light); color: var(--warning-text); border: 1px solid var(--warning-border); }
  .tag.info { background: var(--primary-light); color: var(--text-primary); border: 1px solid var(--border-base); }
  .tag.pub { background: var(--bg-subtle); color: var(--text-secondary); border: 1px solid var(--border-base); }
  #msg:empty, #setup-msg:empty { display: none; }
  #msg, #setup-msg { font-size: 13px; margin-top: .6rem; }
`,
  MODAL_CSS,
  LANG_RULES,
].join("\n");

export const OIDC_FAVICON_DATA_URI = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20512%20512'%3E%3Crect%20width='512'%20height='512'%20rx='112'%20fill='%23181b20'/%3E%3Ccircle%20cx='256'%20cy='256'%20r='144'%20fill='none'%20stroke='%23ffffff'%20stroke-width='32'%20stroke-linecap='round'%20stroke-linejoin='round'/%3E%3Cellipse%20cx='256'%20cy='256'%20rx='72'%20ry='144'%20fill='none'%20stroke='%23ffffff'%20stroke-width='32'%20stroke-linecap='round'%20stroke-linejoin='round'/%3E%3Cline%20x1='112'%20y1='256'%20x2='400'%20y2='256'%20stroke='%23ffffff'%20stroke-width='32'%20stroke-linecap='round'%20stroke-linejoin='round'/%3E%3C/svg%3E";

export const FAVICON_TAG = `<link rel="icon" href="${OIDC_FAVICON_DATA_URI}" type="image/svg+xml">`;