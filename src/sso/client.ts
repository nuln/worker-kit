/**
 * @nuln/worker-kit/sso/client
 *
 * 统一 OIDC 客户端工具：Discovery 发现、授权跳转、Code 换 Token、UserInfo 与 ID Token Claims 解析
 */

import { fromB64url } from "../crypto/index.js";

export interface OidcDiscoveryDoc {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
  end_session_endpoint?: string;
  response_types_supported?: string[];
  scopes_supported?: string[];
}

export interface OidcTokenResponse {
  access_token: string;
  token_type?: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  [key: string]: unknown;
}

export interface OidcUserInfoResponse {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  picture?: string;
  groups?: string[];
  [key: string]: unknown;
}

/** 拉取并解析 OIDC Discovery 配置文档（/.well-known/openid-configuration）。 */
export async function discoverOidc(issuerUrl: string, fetchImpl: typeof fetch = fetch): Promise<OidcDiscoveryDoc> {
  const issuer = String(issuerUrl || "").trim().replace(/\/+$/, "");
  if (!issuer) throw new Error("oidc_issuer_empty");
  const res = await fetchImpl(`${issuer}/.well-known/openid-configuration`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`oidc_discovery_failed: HTTP ${res.status}`);
  const doc = (await res.json()) as OidcDiscoveryDoc;
  if (!doc.authorization_endpoint || !doc.token_endpoint) {
    throw new Error("oidc_discovery_missing_endpoints");
  }
  return doc;
}

/** 构造标准 OIDC 授权跳转地址。 */
export function buildOidcAuthorizeUrl(opts: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
  nonce?: string;
  codeChallenge?: string;
  codeChallengeMethod?: "S256" | "plain";
  prompt?: string;
}): string {
  const u = new URL(opts.authorizationEndpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("scope", opts.scope || "openid profile email");
  u.searchParams.set("state", opts.state);
  if (opts.nonce) u.searchParams.set("nonce", opts.nonce);
  if (opts.codeChallenge) {
    u.searchParams.set("code_challenge", opts.codeChallenge);
    u.searchParams.set("code_challenge_method", opts.codeChallengeMethod || "S256");
  }
  if (opts.prompt) u.searchParams.set("prompt", opts.prompt);
  return u.toString();
}

/** 使用 authorization_code 向 Token 端点兑换 Access Token 与 ID Token。 */
export async function exchangeOidcCode(opts: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
  fetchImpl?: typeof fetch;
}): Promise<OidcTokenResponse> {
  const fetchFn = opts.fetchImpl || fetch;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
  });
  if (opts.clientSecret) {
    body.set("client_secret", opts.clientSecret);
  }
  if (opts.codeVerifier) {
    body.set("code_verifier", opts.codeVerifier);
  }

  const res = await fetchFn(opts.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`oidc_token_exchange_failed: HTTP ${res.status} ${errBody}`);
  }

  return (await res.json()) as OidcTokenResponse;
}

/** 通过 UserInfo 端点获取当前登录用户的标准 Claims。 */
export async function fetchOidcUserInfo(opts: {
  userinfoEndpoint: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<OidcUserInfoResponse> {
  const fetchFn = opts.fetchImpl || fetch;
  const res = await fetchFn(opts.userinfoEndpoint, {
    headers: {
      authorization: `Bearer ${opts.accessToken}`,
      accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`oidc_userinfo_failed: HTTP ${res.status}`);
  }

  return (await res.json()) as OidcUserInfoResponse;
}

/** 解析 JWT / ID Token 的 Payload Claims（Base64URL 安全反解）。 */
export function parseJwtPayload<T = Record<string, unknown>>(token: string): T {
  const parts = String(token || "").split(".");
  if (parts.length < 2) throw new Error("invalid_jwt_format");
  const payloadBytes = fromB64url(parts[1]!);
  const jsonStr = new TextDecoder().decode(payloadBytes);
  return JSON.parse(jsonStr) as T;
}
