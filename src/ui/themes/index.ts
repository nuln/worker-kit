/**
 * @nuln/worker-kit/ui/themes
 * 
 * 多主题设计系统注册与导出中心
 */

export * from "./types.js";
export * as classic from "./classic/index.js";
export * as modern from "./modern/index.js";
export { MODERN_AUTH_STYLE, MODERN_DESIGN_TOKENS } from "./modern/styles.js";
// 从 modern/index 导入（那里已统一包装 CSP nonce，KIT-BUG-04）。
// 直连 ./modern/auth-pages.js 会绕过包装，拿到未补 nonce 的原始实现。
export {
  renderModernSetupHtml,
  renderModernLoginHtml,
  renderModernInviteHtml,
  renderModernRecoveryHtml,
  renderModernConsentHtml,
  renderModernSsoErrorHtml,
} from "./modern/index.js";
