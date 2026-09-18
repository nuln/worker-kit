/**
 * @nuln/worker-kit/ui/themes/modern/styles
 * 
 * Modern Passkey Card 风格设计系统（参考 Pocket-ID 现代卡片风）
 * - 380px 悬浮大圆角（20px）卡片容器，柔和弥散环境光背景（Ambient Mesh Glow）
 * - 大尺寸突出生物识别 / Passkey 主认证按键与指纹微动效
 * - 精致的 1px 高光边框、Zinc 色系、Pill 分段控制器与微光聚焦环（Focus Ring）
 */

import { MODAL_CSS } from "../../modal.js";

export const MODERN_DESIGN_TOKENS = `
  :root {
    color-scheme: light;
    --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

    --bg-canvas: #fafafa;
    --bg-canvas-mesh1: rgba(99, 102, 241, 0.06);
    --bg-canvas-mesh2: rgba(168, 85, 247, 0.04);
    --bg-surface: #ffffff;
    --bg-surface-elevated: #f4f4f5;
    --bg-subtle: #f4f4f5;
    --bg-hover: #e4e4e7;
    --bg-active: #d4d4d8;

    --border-subtle: #f4f4f5;
    --border-base: #e4e4e7;
    --border-strong: #d4d4d8;
    --card-glow: rgba(99, 102, 241, 0.2);

    --text-primary: #09090b;
    --text-secondary: #71717a;
    --text-tertiary: #a1a1aa;
    --text-disabled: #d4d4d8;

    --primary-bg: #18181b;
    --primary-hover: #27272a;
    --primary-text: #fafafa;
    --primary-accent: #6366f1;
    --focus-ring: rgba(99, 102, 241, 0.18);
    --pulse-color: rgba(99, 102, 241, 0.35);

    --success: #10b981;
    --success-bg: rgba(16, 185, 129, 0.08);
    --danger: #ef4444;
    --danger-bg: rgba(239, 68, 68, 0.08);

    --shadow-card: 0 20px 35px -10px rgba(0, 0, 0, 0.06), 0 1px 3px 0 rgba(0, 0, 0, 0.02);
    --shadow-btn: 0 4px 12px 0 rgba(24, 24, 27, 0.12);
  }

  [data-theme="dark"] {
    color-scheme: dark;
    --bg-canvas: #09090b;
    --bg-canvas-mesh1: rgba(99, 102, 241, 0.12);
    --bg-canvas-mesh2: rgba(168, 85, 247, 0.08);
    --bg-surface: #121215;
    --bg-surface-elevated: #18181b;
    --bg-subtle: #18181b;
    --bg-hover: #27272a;
    --bg-active: #3f3f46;

    --border-subtle: #1e1e24;
    --border-base: #27272a;
    --border-strong: #3f3f46;
    --card-glow: rgba(99, 102, 241, 0.35);

    --text-primary: #fafafa;
    --text-secondary: #a1a1aa;
    --text-tertiary: #71717a;
    --text-disabled: #52525b;

    --primary-bg: #fafafa;
    --primary-hover: #ffffff;
    --primary-text: #09090b;
    --primary-accent: #818cf8;
    --focus-ring: rgba(129, 140, 248, 0.25);
    --pulse-color: rgba(129, 140, 248, 0.4);

    --success: #34d399;
    --success-bg: rgba(52, 211, 153, 0.12);
    --danger: #f87171;
    --danger-bg: rgba(248, 113, 113, 0.12);

    --shadow-card: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
    --shadow-btn: 0 4px 14px 0 rgba(0, 0, 0, 0.3);
  }
`;

export const MODERN_AUTH_STYLE = `
  ${MODERN_DESIGN_TOKENS}

  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  
  html, body {
    margin: 0;
    padding: 0;
    min-height: 100vh;
    font-family: var(--font-sans);
    background-color: var(--bg-canvas);
    background-image: 
      radial-gradient(circle at 50% 0%, var(--bg-canvas-mesh1), transparent 50%),
      radial-gradient(circle at 100% 100%, var(--bg-canvas-mesh2), transparent 45%);
    background-attachment: fixed;
    color: var(--text-primary);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  .auth-layout {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 24px 16px;
    position: relative;
    z-index: 1;
  }

  .modern-card {
    width: 100%;
    max-width: 380px;
    background: var(--bg-surface);
    border: 1px solid var(--border-base);
    border-radius: 20px;
    box-shadow: var(--shadow-card);
    padding: 32px 28px 26px;
    position: relative;
    overflow: hidden;
    backdrop-filter: blur(12px);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }

  .modern-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--card-glow), transparent);
  }

  /* 顶部品牌与徽章 */
  .brand-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    margin-bottom: 24px;
  }

  .brand-icon-box {
    width: 48px;
    height: 48px;
    border-radius: 14px;
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-base);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-primary);
    margin-bottom: 12px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  }

  .brand-title {
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.02em;
    margin: 0 0 4px 0;
    color: var(--text-primary);
  }

  .brand-desc {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.4;
  }

  /* 主认证大按钮 (Passkey CTA) */
  .btn-passkey {
    width: 100%;
    height: 48px;
    border-radius: 12px;
    background: var(--primary-bg);
    color: var(--primary-text);
    border: none;
    font-size: 14.5px;
    font-weight: 500;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    cursor: pointer;
    box-shadow: var(--shadow-btn);
    transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .btn-passkey:hover:not(:disabled) {
    background: var(--primary-hover);
    transform: translateY(-1px);
  }

  .btn-passkey:active:not(:disabled) {
    transform: translateY(0);
  }

  .btn-passkey:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-passkey.authenticating {
    animation: pulseGlow 1.5s infinite;
  }

  @keyframes pulseGlow {
    0%, 100% { box-shadow: 0 0 0 0 var(--pulse-color); }
    50% { box-shadow: 0 0 0 8px transparent; }
  }

  /* 次级/轮廓按钮 */
  .btn-outline {
    width: 100%;
    height: 42px;
    border-radius: 10px;
    background: var(--bg-surface);
    color: var(--text-primary);
    border: 1px solid var(--border-base);
    font-size: 13.5px;
    font-weight: 500;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    cursor: pointer;
    text-decoration: none;
    transition: all 0.15s ease;
  }

  .btn-outline:hover:not(:disabled) {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  /* 优雅细线分隔符 */
  .divider {
    display: flex;
    align-items: center;
    margin: 20px 0;
    color: var(--text-tertiary);
    font-size: 12px;
  }

  .divider::before, .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border-base);
  }

  .divider span {
    padding: 0 10px;
  }

  /* 输入框 */
  .form-group {
    margin-bottom: 12px;
    width: 100%;
    text-align: left;
  }

  .form-label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    margin-bottom: 6px;
  }

  .form-input {
    width: 100%;
    height: 42px;
    border-radius: 10px;
    border: 1px solid var(--border-base);
    background: var(--bg-surface-elevated);
    padding: 0 14px;
    font-size: 13.5px;
    font-family: inherit;
    color: var(--text-primary);
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .form-input:focus {
    border-color: var(--primary-accent);
    box-shadow: 0 0 0 3px var(--focus-ring);
  }

  .form-input::placeholder {
    color: var(--text-tertiary);
  }

  /* 提示与消息条 */
  .msg-banner {
    min-height: 18px;
    margin-top: 12px;
    font-size: 12px;
    text-align: center;
    color: var(--danger);
    word-break: break-all;
  }

  /* 底部辅助链接 */
  .footer-links {
    margin-top: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    font-size: 12.5px;
  }

  .footer-links a {
    color: var(--text-secondary);
    text-decoration: none;
    transition: color 0.15s ease;
  }

  .footer-links a:hover {
    color: var(--text-primary);
  }

  /* 右上角浮动胶囊控制区 (Theme & Lang) */
  .top-floating-bar {
    position: fixed;
    top: 16px;
    right: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 10;
  }

  .floating-pill {
    height: 32px;
    padding: 0 10px;
    border-radius: 9999px;
    background: var(--bg-surface);
    border: 1px solid var(--border-base);
    box-shadow: 0 2px 6px rgba(0,0,0,0.04);
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
    backdrop-filter: blur(8px);
  }

  .floating-pill:hover {
    color: var(--text-primary);
    border-color: var(--border-strong);
    background: var(--bg-hover);
  }

  /* OAuth Scopes 权限 Badge 列表 */
  .scope-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 12px 0;
  }

  .scope-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: 9999px;
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-base);
    font-size: 11.5px;
    color: var(--text-secondary);
  }

  .scope-pill svg {
    color: var(--success);
  }

  ${MODAL_CSS}
`;
