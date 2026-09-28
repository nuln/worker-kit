/**
 * @nuln/worker-kit/ui/themes/types
 * 
 * 多主题设计系统类型定义
 */

import type { Lang } from "../i18n.js";

export type UiTheme = "classic" | "modern";

export interface BasePageOptions {
  /** Worker 环境对象；仅 setup 视图使用（见 RenderSetupOptions） */
  env?: Record<string, unknown> | null;
  /** 初始化前置需求；仅 setup 视图使用 */
  requirements?: import("../../config/requirements.js").Requirements;
  serviceName: string;
  basePath?: string;
  lang?: Lang | string;
  request?: Request;
  theme?: UiTheme;
  /**
   * CSP nonce（KIT-BUG-04）。
   *
   * 严格 CSP（`script-src 'nonce-xxx'` 且无 `'unsafe-inline'`）下，
   * 不带 nonce 的内联 `<script>` / `<style>` 会被浏览器直接阻断 ——
   * 症状是 WebAuthn 交互脚本不执行、样式全丢，而服务端日志一片干净。
   *
   * **不传则完全不输出 nonce 属性**（向后兼容，既有渲染结果不变）。
   */
  cspNonce?: string;
}

export interface RenderSetupOptions extends BasePageOptions {
  /**
   * Worker 环境对象。传入后，`/setup` 会先评估 {@link requirements}，
   * 缺配置时显示"需要配置什么"面板而**不进入初始化流程**。
   */
  env?: Record<string, unknown> | null;
  /**
   * 初始化前置需求（纯数据）。加环境变量只需往数组加一行，无需改渲染代码。
   *
   * 见 `@nuln/worker-kit/config` 的 `REQUIREMENTS` 预设与 `defineRequirements`。
   */
  requirements?: import("../../config/requirements.js").Requirements;
  email?: string;
  defaultEmail?: string;
  name?: string;
  pkName?: string;
  localPart?: string;
  step?: "init" | "done";
}

export interface RenderLoginOptions extends BasePageOptions {
  error?: string;
  ssoProviders?: Array<{ id: string; name: string; icon?: string }>;
  enableRecovery?: boolean;
  needsSetup?: boolean;
  oidcEnabled?: boolean;
  next?: string;
  /**
   * OIDC 入口文案覆盖（缺省取字典 `oidcLogin`）。
   * 由服务端传入以适配各服务自有措辞；渲染前会做 escapeHtml 兜底。
   */
  oidcButtonText?: string;
}

export interface RenderInviteOptions extends BasePageOptions {
  inviteCode?: string;
  prefillEmail?: string;
}

export interface RenderRecoveryOptions extends BasePageOptions {}

export interface RenderOidcChoiceOptions extends BasePageOptions {
  email: string;
  name?: string;
  domains?: string[];
}

export interface RenderConsentOptions extends BasePageOptions {
  clientId: string;
  clientName: string;
  scopes: string[];
  redirectUri: string;
  userEmail: string;
  userName?: string;
  csrfToken: string;
}

export interface RenderSsoErrorOptions extends BasePageOptions {
  error?: string;
  errorDescription?: string;
  retryUrl?: string;
  loginUrl?: string;
}

/**
 * 支持的认证页视图。
 *
 * 这里只列**确实有渲染实现**的视图。历史上曾多列一个 `oidc-choice`，
 * 但全仓库没有任何对应渲染器 —— 调用 `renderAuthPage({ view: "oidc-choice" })`
 * 会静默拿到空字符串（白屏），类型却声称它合法。
 * 宁可类型少一个，也不要类型撒谎。
 */
export type AuthPageView =
  | "setup"
  | "login"
  | "invite"
  | "recovery"
  | "sso-error"
  | "consent";

export interface AuthPageResponseOptions extends BasePageOptions {
  view: AuthPageView;
  email?: string;
  name?: string;
  pkName?: string;
  localPart?: string;
  inviteCode?: string;
  error?: string;
  errorDescription?: string;
  retryUrl?: string;
  loginUrl?: string;
  ssoProviders?: Array<{ id: string; name: string; icon?: string }>;
  enableRecovery?: boolean;
  clientId?: string;
  clientName?: string;
  scopes?: string[];
  redirectUri?: string;
  userEmail?: string;
  userName?: string;
  csrfToken?: string;
  domains?: string[];
}
