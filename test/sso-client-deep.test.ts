import { describe, it, expect, vi } from "vitest";
import {
  discoverOidc,
  buildOidcAuthorizeUrl,
  exchangeOidcCode,
  fetchOidcUserInfo,
  parseJwtPayload,
  OidcClient,
} from "../src/sso/client.js";
import { toB64url } from "../src/crypto/index.js";

describe("@nuln/worker-kit/sso/client - Deep Unit & Branch Coverage", () => {
  it("discoverOidc parses discovery document and throws on missing endpoints or network fail", async () => {
    await expect(discoverOidc("")).rejects.toThrow("oidc_issuer_empty");

    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ authorization_endpoint: "https://auth/auth", token_endpoint: "https://auth/token" }), {
        status: 200,
      })
    );
    const doc = await discoverOidc("https://auth.nuln.net/", mockFetch as any);
    expect(doc.authorization_endpoint).toBe("https://auth/auth");
    expect(doc.token_endpoint).toBe("https://auth/token");

    // Network failure
    const errorFetch = vi.fn().mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
    await expect(discoverOidc("https://auth.nuln.net", errorFetch as any)).rejects.toThrow(
      "oidc_discovery_failed: HTTP 404"
    );

    // Missing endpoints in json
    const missingEndpointsFetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    await expect(discoverOidc("https://auth.nuln.net", missingEndpointsFetch as any)).rejects.toThrow(
      "oidc_discovery_missing_endpoints"
    );
  });

  it("buildOidcAuthorizeUrl formats query parameters correctly", () => {
    const url = buildOidcAuthorizeUrl({
      authorizationEndpoint: "https://auth.nuln.net/oauth/authorize",
      clientId: "client_123",
      redirectUri: "https://app.nuln.net/callback",
      state: "state_xyz",
      scope: "openid profile email offline_access",
      nonce: "nonce_456",
      codeChallenge: "challenge_abc",
      codeChallengeMethod: "S256",
      prompt: "consent",
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get("client_id")).toBe("client_123");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://app.nuln.net/callback");
    expect(parsed.searchParams.get("state")).toBe("state_xyz");
    expect(parsed.searchParams.get("nonce")).toBe("nonce_456");
    expect(parsed.searchParams.get("code_challenge")).toBe("challenge_abc");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
  });

  it("exchangeOidcCode performs POST with client_secret and code_verifier", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "at_123", id_token: "it_456", expires_in: 3600 }), {
        status: 200,
      })
    );

    const res = await exchangeOidcCode({
      tokenEndpoint: "https://auth.nuln.net/oauth/token",
      clientId: "c_id",
      clientSecret: "c_secret",
      code: "code_999",
      redirectUri: "https://app.nuln.net/cb",
      codeVerifier: "verifier_abc",
      fetchImpl: mockFetch as any,
    });

    expect(res.access_token).toBe("at_123");
    const reqBody = mockFetch.mock.calls[0][1].body;
    expect(reqBody).toContain("client_secret=c_secret");
    expect(reqBody).toContain("code_verifier=verifier_abc");

    // Failure case
    mockFetch.mockResolvedValueOnce(new Response("invalid_grant", { status: 400 }));
    await expect(
      exchangeOidcCode({
        tokenEndpoint: "https://auth.nuln.net/oauth/token",
        clientId: "c_id",
        code: "bad_code",
        redirectUri: "https://app.nuln.net/cb",
        fetchImpl: mockFetch as any,
      })
    ).rejects.toThrow("oidc_token_exchange_failed: HTTP 400");
  });

  it("fetchOidcUserInfo fetches claims and handles errors", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ sub: "usr_1", email: "alice@nuln.net", name: "Alice" }), {
        status: 200,
      })
    );

    const userinfo = await fetchOidcUserInfo({
      userinfoEndpoint: "https://auth.nuln.net/userinfo",
      accessToken: "token_123",
      fetchImpl: mockFetch as any,
    });

    expect(userinfo.sub).toBe("usr_1");
    expect(userinfo.email).toBe("alice@nuln.net");
    expect(mockFetch.mock.calls[0][1].headers.authorization).toBe("Bearer token_123");

    // Failure case
    mockFetch.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
    await expect(
      fetchOidcUserInfo({
        userinfoEndpoint: "https://auth.nuln.net/userinfo",
        accessToken: "invalid",
        fetchImpl: mockFetch as any,
      })
    ).rejects.toThrow("oidc_userinfo_failed: HTTP 401");
  });

  it("parseJwtPayload extracts claims and rejects invalid JWT", () => {
    const payload = { sub: "u123", email: "test@nuln.net", exp: 1800000000 };
    const payloadB64 = toB64url(new TextEncoder().encode(JSON.stringify(payload)));
    const fakeJwt = `eyJhbGciOiJIUzI1NiJ9.${payloadB64}.fakesignature`;

    const parsed = parseJwtPayload(fakeJwt);
    expect(parsed.sub).toBe("u123");
    expect(parsed.email).toBe("test@nuln.net");

    expect(() => parseJwtPayload("bad-token")).toThrow("invalid_jwt_format");
  });

  it("OidcClient class high-level methods", async () => {
    const discoveryDoc = {
      authorization_endpoint: "https://auth.nuln.net/authorize",
      token_endpoint: "https://auth.nuln.net/token",
      userinfo_endpoint: "https://auth.nuln.net/userinfo",
    };

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes(".well-known/openid-configuration")) {
        return Promise.resolve(new Response(JSON.stringify(discoveryDoc)));
      }
      if (url.includes("/token")) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: "at_abc" })));
      }
      if (url.includes("/userinfo")) {
        return Promise.resolve(new Response(JSON.stringify({ sub: "user_777" })));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const client = new OidcClient({
      issuer: "https://auth.nuln.net",
      clientId: "client_id_01",
      redirectUri: "https://app.nuln.net/cb",
      fetchImpl: mockFetch as any,
    });

    const authUrl = await client.getAuthorizeUrl({ state: "st_123", codeChallenge: "chal" });
    expect(authUrl).toContain("https://auth.nuln.net/authorize");
    expect(authUrl).toContain("client_id=client_id_01");

    const tokens = await client.exchangeCode("auth_code_1", "verifier_1");
    expect(tokens.access_token).toBe("at_abc");

    const userinfo = await client.getUserInfo("at_abc");
    expect(userinfo.sub).toBe("user_777");

    // Missing userinfo endpoint in discovery
    const clientNoUserinfo = new OidcClient({
      issuer: "https://auth.nuln.net",
      clientId: "client_id_01",
      redirectUri: "https://app.nuln.net/cb",
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            authorization_endpoint: "https://auth/auth",
            token_endpoint: "https://auth/token",
          })
        )
      ) as any,
    });

    await expect(clientNoUserinfo.getUserInfo("at")).rejects.toThrow("oidc_no_userinfo_endpoint");
  });
});
