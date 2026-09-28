/**
 * Example 06: OpenID Connect (OIDC) SSO Client & Flow
 *
 * Demonstrates:
 * 1. Automatic OIDC Discovery configuration fetching
 * 2. Generating Authorization URL with PKCE (S256) and state protection
 * 3. Exchanging Authorization Code for Access Token and ID Token
 * 4. Fetching user profile from UserInfo endpoint
 */

import { OidcClient, parseJwtPayload } from "@nuln/worker-kit";

export async function runSsoExample() {
  console.log("=== [Example 06] OIDC SSO Client Integration ===");

  const oidcClient = new OidcClient({
    issuer: "https://auth.nuln.net/oidc",
    clientId: "service_tower_client",
    clientSecret: "tower_oidc_secret_xyz",
    redirectUri: "https://tower.nuln.net/admin/oidc/callback",
    scope: "openid profile email",
  });

  // 1. Generate Auth URL for user redirection
  const authUrl = await oidcClient.getAuthorizeUrl({
    state: "random_csrf_state_123",
    nonce: "random_nonce_456",
  });
  console.log("Redirecting user to:", authUrl);

  // 2. Token Exchange on callback (Simulated)
  // const tokens = await oidcClient.exchangeCode("auth_code_from_idp");
  // const userProfile = await oidcClient.getUserInfo(tokens.access_token);
  // console.log("Logged in user:", userProfile.email, userProfile.name);
}
