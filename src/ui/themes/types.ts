/**
 * @nuln/worker-kit/ui/themes/types
 * 
 * 多主题设计系统类型定义
 */

import type { Lang } from "../i18n.js";

export type UiTheme = "classic" | "modern";

export interface BasePageOptions {
  serviceName: string;
  basePath?: string;
  lang?: Lang | string;
  request?: Request;
  theme?: UiTheme;
}

export interface RenderSetupOptions extends BasePageOptions {
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

export type AuthPageView =
  | "setup"
  | "login"
  | "invite"
  | "recovery"
  | "sso-error"
  | "consent"
  | "oidc-choice";

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
