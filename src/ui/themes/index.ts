/**
 * @nuln/worker-kit/ui/themes
 * 
 * 多主题设计系统注册与导出中心
 */

export * from "./types.js";
export * as classic from "./classic/index.js";
export * as modern from "./modern/index.js";
export { MODERN_AUTH_STYLE, MODERN_DESIGN_TOKENS } from "./modern/styles.js";
export {
  renderModernSetupHtml,
  renderModernLoginHtml,
  renderModernInviteHtml,
  renderModernRecoveryHtml,
  renderModernConsentHtml,
  renderModernSsoErrorHtml,
} from "./modern/auth-pages.js";
