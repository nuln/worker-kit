/**
 * @nuln/worker-kit/ui — 初始化前置检查面板
 *
 * ## 为什么需要这个组件
 *
 * 首次访问 `/setup` 时，如果服务依赖的环境变量还没注入，页面过去仍正常渲染
 * 初始化表单 —— 用户填完邮箱、绑完 Passkey，才在后续请求上炸掉；或者更糟的
 * **"假成功"**（邮件只打到控制台、限流根本没生效）。
 *
 * 现在 `/setup` 先评估依赖：**缺什么就先显示什么**，不进入初始化流程。
 *
 * ## 关键约束：加环境变量不改代码
 *
 * 面板是**纯数据驱动**的 —— 遍历 {@link SetupRequirement} 数组渲染，
 * 没有任何按变量名的 switch/分支。因此新增一个环境变量只需要往数组里加一行，
 * 页面与 API 拦截自动生效。
 */

import { escapeHtml } from "../http/index.js";
import type { ConfigProblem } from "../config/index.js";
import { getAuthI18n, type Lang } from "./i18n.js";

/** 类别 → 展示徽标文案。 */
const KIND_LABEL: Record<string, { zh: string; en: string }> = {
  secret: { zh: "密钥", en: "Secret" },
  binding: { zh: "绑定", en: "Binding" },
  var: { zh: "环境变量", en: "Env Var" },
  apiKey: { zh: "第三方凭据", en: "API Key" },
};

export interface MissingConfigPanelOptions {
  serviceName: string;
  /** 评估结果：blocking 为阻断项，advisory 为建议项 */
  blocking: ConfigProblem[];
  advisory?: ConfigProblem[];
  lang?: Lang | string;
  /** 已配置项数 / 总数，用于进度提示 */
  configuredCount?: number;
  totalCount?: number;
}

function kindLabel(kind: string, isEn: boolean): string {
  const l = KIND_LABEL[kind] ?? KIND_LABEL.var;
  return isEn ? l.en : l.zh;
}

/** 把 HTML 注释形式不可用 —— 面板直接输出 HTML 字符串片段。 */
export function renderMissingConfigPanel(opts: MissingConfigPanelOptions): string {
  const isEn = String(opts.lang ?? "zh").startsWith("en");
  const t = getAuthI18n(opts.lang);
  const advisory = opts.advisory ?? [];

  const item = (p: ConfigProblem) => `
    <li class="cfg-item">
      <div class="cfg-head">
        <span class="cfg-kind">${escapeHtml(kindLabel(p.kind, isEn))}</span>
        <code class="cfg-name">${escapeHtml(p.name)}</code>
      </div>
      <p class="cfg-reason">${escapeHtml(p.reason)}</p>
      <p class="cfg-hint"><span class="cfg-hint-label">${escapeHtml(isEn ? "How to fix" : "如何配置")}</span><code>${escapeHtml(p.hint)}</code></p>
    </li>`;

  const advisoryBlock = advisory.length
    ? `
    <div class="cfg-section cfg-section-advisory">
      <h3 class="cfg-section-title">${escapeHtml(isEn ? "Recommended" : "建议配置")}</h3>
      <ul class="cfg-list">${advisory.map(item).join("")}</ul>
    </div>`
    : "";

  const progress =
    opts.configuredCount !== undefined && opts.totalCount !== undefined
      ? `<p class="cfg-progress">${escapeHtml(
          isEn
            ? `Configured ${opts.configuredCount} of ${opts.totalCount}`
            : `已配置 ${opts.configuredCount} / ${opts.totalCount}`,
        )}</p>`
      : "";

  return `
<div class="cfg-panel" role="alert">
  <div class="cfg-icon" aria-hidden="true">⚠</div>
  <h1 class="cfg-title">${escapeHtml(
    isEn ? "Setup blocked: configuration required" : "初始化已阻止：需要先完成配置",
  )}</h1>
  <p class="cfg-desc">${escapeHtml(
    isEn
      ? `${opts.serviceName} cannot start initialization because the following configuration is missing. Set them first, then reload this page.`
      : `${opts.serviceName} 目前无法进入初始化流程，因为以下配置尚未完成。请先补齐，然后刷新本页面。`,
  )}</p>
  ${progress}
  <div class="cfg-section">
    <h3 class="cfg-section-title">${escapeHtml(
      isEn ? `Required (${opts.blocking.length})` : `必须配置（${opts.blocking.length}）`,
    )}</h3>
    <ul class="cfg-list">${opts.blocking.map(item).join("")}</ul>
  </div>
  ${advisoryBlock}
  <p class="cfg-foot">${escapeHtml(
    isEn
      ? "Tip: the initialization form appears automatically once all required items are set."
      : "提示：全部必填项补齐后，本页面会自动切换为初始化表单。",
  )}</p>
</div>`;
}

/** 面板样式（追加到认证页样式表末尾）。 */
export const MISSING_CONFIG_CSS = `
  .cfg-panel {
    max-width: 100%; text-align: left;
    border: 1px solid #f59e0b; border-radius: var(--radius-lg);
    background: rgba(245, 158, 11, 0.06); padding: 16px 18px;
  }
  .cfg-icon { font-size: 20px; line-height: 1; }
  .cfg-title {
    font-size: 15px; font-weight: 600; margin: 8px 0 6px 0;
    letter-spacing: -0.01em; color: var(--text-primary);
  }
  .cfg-desc { font-size: 12.5px; line-height: 1.6; color: var(--text-secondary); margin: 0 0 12px; }
  .cfg-progress { font-size: 12px; color: var(--text-secondary); margin: 0 0 10px; }
  .cfg-section { margin-top: 12px; }
  .cfg-section-title {
    font-size: 12px; font-weight: 600; color: var(--text-secondary);
    margin: 0 0 6px 0; text-transform: uppercase; letter-spacing: 0.04em;
  }
  .cfg-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .cfg-item { border: 1px solid var(--border-base); border-radius: var(--radius-md); padding: 9px 11px; background: var(--bg-surface); }
  .cfg-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .cfg-kind {
    font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 999px;
    background: rgba(245, 158, 11, 0.15); color: #b45309; white-space: nowrap;
  }
  .cfg-name {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12.5px; font-weight: 600; color: var(--text-primary);
  }
  .cfg-reason { font-size: 12px; line-height: 1.55; color: var(--text-secondary); margin: 5px 0 0; }
  .cfg-hint { font-size: 11.5px; line-height: 1.5; color: var(--text-tertiary, var(--text-secondary)); margin: 4px 0 0; display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
  .cfg-hint-label { opacity: 0.75; }
  .cfg-hint code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    background: rgba(0, 0, 0, 0.05); padding: 1px 5px; border-radius: 4px;
  }
  .cfg-section-advisory .cfg-item { opacity: 0.8; }
  .cfg-foot { font-size: 11.5px; color: var(--text-tertiary, var(--text-secondary)); margin: 14px 0 0; }
`;
