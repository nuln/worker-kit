/**
 * @nuln/worker-kit/ui/themes/modern
 *
 * Modern Passkey Card 现代卡片风格导出（参考 Pocket-ID 设计风）
 *
 * ## 关于 CSP nonce（KIT-BUG-04）
 *
 * 这里的每个渲染器都会被包一层，统一对输出补 `nonce` 属性：
 *
 * - **为什么在出口包而不是在模板里逐处插入**：模板里有十几处内联
 *   `<script>` / `<style>`，逐个条件插入极易漏；漏掉的那一个会让页面
 *   在严格 CSP 下**部分**失效（某个按钮点了没反应），症状与原因相隔极远。
 * - **为什么用包装而不是改 6 个函数体**：单一入口意味着将来新增页面
 *   不需要记得改这里 —— 漏改的代价是"新页面在 CSP 下不工作"，
 *   而这类问题只有部署到严格 CSP 环境才会暴露。
 *
 * 原始实现（`./auth-pages.js`）保持不变，对内调用与直接 import 均不受影响。
 */

import { applyCspNonce } from "../../script-safety.js";
import {
  renderModernSetupHtml as _renderSetup,
  renderModernLoginHtml as _renderLogin,
  renderModernInviteHtml as _renderInvite,
  renderModernRecoveryHtml as _renderRecovery,
  renderModernConsentHtml as _renderConsent,
  renderModernSsoErrorHtml as _renderSsoError,
} from "./auth-pages.js";
import type {
  RenderSetupOptions,
  RenderLoginOptions,
  RenderInviteOptions,
  RenderRecoveryOptions,
  RenderConsentOptions,
  RenderSsoErrorOptions,
} from "../types.js";

export * from "./styles.js";
export * from "./auth-pages.js";

/** 补 nonce 的通用包装（无 nonce 时原样返回，渲染结果与之前完全一致） */
const withNonce = <T extends { cspNonce?: string }>(
  fn: (opts: T) => string,
): ((opts: T) => string) =>
  (opts: T): string => applyCspNonce(fn(opts), opts?.cspNonce);

export const renderModernSetupHtml = withNonce(_renderSetup);
export const renderModernLoginHtml = withNonce(_renderLogin);
export const renderModernInviteHtml = withNonce(_renderInvite);
export const renderModernRecoveryHtml = withNonce(_renderRecovery);
export const renderModernConsentHtml = withNonce(_renderConsent);
export const renderModernSsoErrorHtml = withNonce(_renderSsoError);
