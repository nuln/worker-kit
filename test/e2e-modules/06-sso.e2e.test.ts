import { describe, it, expect, vi } from "vitest";
import { OidcClient, buildOidcAuthorizeUrl, parseJwtPayload } from "../../src/sso/client.js";
import { toB64url } from "../../src/crypto/index.js";

describe("[E2E Example] 06 - SSO OIDC & OAuth2 PKCE Full Authorization Code Flow", () => {
  it("completes discovery, PKCE authorize url generation, code-token exchange, and UserInfo query", async () => {
    // 1. Mock IdP Responses
    const discoveryDoc = {
      issuer: "https://oidc.nuln.net",
      authorization_endpoint: "https://oidc.nuln.net/oauth/authorize",
      token_endpoint: "https://oidc.nuln.net/oauth/token",
      userinfo_endpoint: "https://oidc.nuln.net/oauth/userinfo",
    };

    const idTokenPayload = {
      sub: "usr_alice_999",
      email: "alice@nuln.net",
      name: "Alice Wang",
      iss: "https://oidc.nuln.net",
      aud: "client_mail_app",
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const idTokenB64 = toB64url(new TextEncoder().encode(JSON.stringify(idTokenPayload)));
    const fakeIdToken = `eyJhbGciOiJIUzI1NiJ9.${idTokenB64}.fakesig`;

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/.well-known/openid-configuration")) {
        return Promise.resolve(new Response(JSON.stringify(discoveryDoc)));
      }
      if (url.includes("/oauth/token")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: "at_access_token_secure",
              id_token: fakeIdToken,
              token_type: "Bearer",
              expires_in: 3600,
            })
          )
        );
      }
      if (url.includes("/oauth/userinfo")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              sub: "usr_alice_999",
              email: "alice@nuln.net",
              name: "Alice Wang",
              groups: ["admin", "developers"],
            })
          )
        );
      }
      return Promise.resolve(new Response("Not Found", { status: 404 }));
    });

    // 2. Initialize OIDC Client
    const oidc = new OidcClient({
      issuer: "https://oidc.nuln.net",
      clientId: "client_mail_app",
      clientSecret: "client_mail_secret",
      redirectUri: "https://mail.nuln.net/auth/callback",
      scope: "openid profile email",
      fetchImpl: mockFetch as any,
    });

    // 3. Step 1: Redirect user to Authorization Endpoint with PKCE
    const authUrl = await oidc.getAuthorizeUrl({
      state: "state_random_nonce_123",
      codeChallenge: "pkce_challenge_hash",
    });

    expect(authUrl).toContain("https://oidc.nuln.net/oauth/authorize");
    expect(authUrl).toContain("client_id=client_mail_app");
    expect(authUrl).toContain("state=state_random_nonce_123");

    // 4. Step 2: Callback receives code and exchanges for tokens
    const tokens = await oidc.exchangeCode("auth_code_received_from_idp", "pkce_verifier_original");
    expect(tokens.access_token).toBe("at_access_token_secure");
    expect(tokens.id_token).toBeDefined();

    // 5. Step 3: Decode ID Token Claims
    const claims = parseJwtPayload<typeof idTokenPayload>(tokens.id_token!);
    expect(claims.sub).toBe("usr_alice_999");
    expect(claims.email).toBe("alice@nuln.net");

    // 6. Step 4: Fetch User Profile from UserInfo endpoint
    const userInfo = await oidc.getUserInfo(tokens.access_token);
    expect(userInfo.sub).toBe("usr_alice_999");
    expect(userInfo.name).toBe("Alice Wang");
    expect(userInfo.groups).toContain("developers");
  });
});
