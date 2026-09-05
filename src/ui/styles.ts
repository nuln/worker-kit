/**
 * @nuln/worker-kit/ui/styles
 *
 * Nuln 生态统一 UI 样式系统（灰白极简 / Charcoal Slate）
 * 提供 DESIGN_TOKENS, BASE_RULES, TOPBAR_RULES, AUTH_STYLE, PAGE_STYLE 与 FAVICON_TAG
 */

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

    --success: #15803d;
    --success-light: #f0fdf4;
    --success-border: #dcfce7;
    --success-text: #166534;
    --warning: #b45309;
    --warning-light: #fffbeb;
    --warning-border: #fef3c7;
    --warning-text: #92400e;
    --danger: #b91c1c;
    --danger-light: #fef2f2;
    --danger-border: #fee2e2;
    --danger-text: #991b1b;

    --neutral-badge-bg: #f1f3f5;
    --neutral-badge-border: #e2e5e9;
    --neutral-badge-text: #414853;

    --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.03);
    --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03);
    --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.06), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
    --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -2px rgba(0, 0, 0, 0.03);
    --shadow-modal: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);

    --radius-xs: 3px;
    --radius-sm: 6px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --radius-full: 9999px;
  }

  [data-theme="light"] {
    color-scheme: light;
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

    --neutral-badge-bg: #f1f3f5;
    --neutral-badge-border: #e2e5e9;
    --neutral-badge-text: #414853;
  }

  [data-theme="dark"] {
    color-scheme: dark;
    --bg-canvas: #0c0e12;
    --bg-surface: #14171d;
    --bg-surface-elevated: #1a1e26;
    --bg-subtle: #1c212b;
    --bg-hover: #242a37;
    --bg-active: #2d3444;

    --border-subtle: #1f242e;
    --border-base: #282f3c;
    --border-strong: #3d4658;

    --text-primary: #f0f2f5;
    --text-secondary: #9da7b5;
    --text-tertiary: #6c7686;
    --text-disabled: #474f5d;

    --primary: #f0f2f5;
    --primary-hover: #ffffff;
    --primary-light: #1c212b;
    --primary-border: #3d4658;
    --primary-text: #f0f2f5;
    --primary-contrast: #0c0e12;
    --primary-ring: rgba(240, 242, 245, 0.15);

    --neutral-badge-bg: #1c212b;
    --neutral-badge-border: #282f3c;
    --neutral-badge-text: #c2c8d1;
  }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --bg-canvas: #0c0e12;
      --bg-surface: #14171d;
      --bg-surface-elevated: #1a1e26;
      --bg-subtle: #1c212b;
      --bg-hover: #242a37;
      --bg-active: #2d3444;

      --border-subtle: #1f242e;
      --border-base: #282f3c;
      --border-strong: #3d4658;

      --text-primary: #f0f2f5;
      --text-secondary: #9da7b5;
      --text-tertiary: #6c7686;
      --text-disabled: #474f5d;

      --primary: #f0f2f5;
      --primary-hover: #ffffff;
      --primary-light: #1c212b;
      --primary-border: #3d4658;
      --primary-text: #f0f2f5;
      --primary-contrast: #0c0e12;
      --primary-ring: rgba(240, 242, 245, 0.15);

      --neutral-badge-bg: #1c212b;
      --neutral-badge-border: #282f3c;
      --neutral-badge-text: #c2c8d1;
    }
  }
`;

export const AUTH_STYLE = `
  ${DESIGN_TOKENS}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--font-sans);
    background: var(--bg-canvas);
    color: var(--text-primary);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .auth-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-base);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
    width: 100%;
    max-width: 400px;
    padding: 32px 28px;
  }
  .auth-title {
    font-size: 20px;
    font-weight: 700;
    margin-bottom: 6px;
    text-align: center;
  }
  .auth-desc {
    font-size: 13px;
    color: var(--text-secondary);
    text-align: center;
    margin-bottom: 24px;
  }
  .form-group {
    margin-bottom: 16px;
  }
  .form-label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 6px;
  }
  .input-text {
    width: 100%;
    height: 38px;
    padding: 0 12px;
    border: 1px solid var(--border-base);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-size: 14px;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .input-text:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--primary-ring);
  }
  .btn {
    width: 100%;
    height: 38px;
    border-radius: var(--radius-sm);
    font-size: 14px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    text-decoration: none;
    transition: all 0.15s;
    border: none;
  }
  .btn-primary {
    background: var(--primary);
    color: var(--primary-contrast);
  }
  .btn-primary:hover {
    background: var(--primary-hover);
  }
  .btn-secondary {
    background: var(--bg-subtle);
    color: var(--text-primary);
    border: 1px solid var(--border-base);
  }
  .btn-secondary:hover {
    background: var(--bg-hover);
  }
  .divider {
    display: flex;
    align-items: center;
    text-align: center;
    margin: 20px 0;
    color: var(--text-tertiary);
    font-size: 12px;
  }
  .divider::before, .divider::after {
    content: '';
    flex: 1;
    border-bottom: 1px solid var(--border-subtle);
  }
  .divider::before { margin-right: 12px; }
  .divider::after { margin-left: 12px; }
  .error-box {
    background: var(--danger-light);
    border: 1px solid var(--danger-border);
    color: var(--danger-text);
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    margin-bottom: 16px;
  }
`;

export const FAVICON_TAG = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23111418' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 2L2 7l10 5 10-5-10-5z'/%3E%3Cpath d='M2 17l10 5 10-5'/%3E%3Cpath d='M2 12l10 5 10-5'/%3E%3C/svg%3E">`;
