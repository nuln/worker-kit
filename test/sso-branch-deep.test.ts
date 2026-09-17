import { describe, it, expect, vi } from "vitest";
import {
  OidcClient,
  discoverOidc,
  exchangeOidcCode,
  fetchOidcUserInfo,
  parseJwtPayload,
  resolveOidcIssuer,
  resolveOidcRedirectUri,
  isSafeNextUrl,
} from "../src/sso/index.js";

describe("SSO Module - Deep Branch & Error Handling Coverage", () => {
  it("handles discovery failure gracefully and throws descriptive error", async () => {
    const mockFetch = vi.fn(async () => new Response("Not Found", { status: 404 }));

    await expect(discoverOidc("https://auth.invalid.nuln.net", mockFetch as any)).rejects.toThrow("oidc_discovery_failed");
    await expect(discoverOidc("", mockFetch as any)).rejects.toThrow("oidc_issuer_empty");
  });

  it("handles token exchange failure gracefully and throws descriptive error", async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    });

    await expect(exchangeOidcCode({
      tokenEndpoint: "https://auth.nuln.net/token",
      clientId: "client_123",
      clientSecret: "secret_123",
      code: "bad_code",
      redirectUri: "https://app.nuln.net/callback",
      fetchImpl: mockFetch as any,
    })).rejects.toThrow("oidc_token_exchange_failed");
  });

  it("handles userinfo failure gracefully and throws descriptive error", async () => {
    const mockFetch = vi.fn(async () => new Response("Unauthorized", { status: 401 }));

    await expect(fetchOidcUserInfo({
      userinfoEndpoint: "https://auth.nuln.net/userinfo",
      accessToken: "invalid_token",
      fetchImpl: mockFetch as any,
    })).rejects.toThrow("oidc_userinfo_failed");
  });

  it("covers parseJwtPayload and OidcClient helper methods", async () => {
    const fakeJwt = "header.eyJzdWIiOiJ1c3JfMTIzIiwiZW1haWwiOiJ0ZXN0QG51bG4ubmV0In0.signature";
    const payload = parseJwtPayload<any>(fakeJwt);
    expect(payload.sub).toBe("usr_123");
    expect(payload.email).toBe("test@nuln.net");

    expect(() => parseJwtPayload("invalid_jwt")).toThrow("invalid_jwt_format");

    const mockFetch = vi.fn(async (url: any) => {
      if (String(url).includes(".well-known")) {
        return new Response(JSON.stringify({
          authorization_endpoint: "https://auth.nuln.net/auth",
          token_endpoint: "https://auth.nuln.net/token",
          userinfo_endpoint: "https://auth.nuln.net/userinfo",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const client = new OidcClient({
      issuer: "https://auth.nuln.net",
      clientId: "client_123",
      redirectUri: "https://app.nuln.net/callback",
      fetchImpl: mockFetch as any,
    });

    const authUrl = await client.getAuthorizeUrl({ state: "xyz", nonce: "n1" });
    expect(authUrl).toContain("https://auth.nuln.net/auth");
    expect(authUrl).toContain("state=xyz");
  });

  it("covers resolveOidcIssuer, resolveOidcRedirectUri, and isSafeNextUrl branches", () => {
    expect(() => resolveOidcIssuer("")).toThrow("OIDC not configured");
    expect(() => resolveOidcIssuer("/oidc")).toThrow("request context required");
    expect(() => resolveOidcIssuer("ftp://invalid")).toThrow("invalid_oidc_issuer_config");

    const validIssuer = resolveOidcIssuer("https://auth.nuln.net", "https://app.nuln.net", "*");
    expect(validIssuer).toBe("https://auth.nuln.net");

    const relIssuer = resolveOidcIssuer("/oidc", "https://app.nuln.net", "*");
    expect(relIssuer).toBe("https://app.nuln.net/oidc");

    // resolveOidcRedirectUri with dot segments
    expect(() => resolveOidcRedirectUri(undefined, "https://app.nuln.net", "/base/..", undefined, "*")).toThrow("invalid_callback_subpath");

    // resolveOidcRedirectUri standard
    const redir = resolveOidcRedirectUri(undefined, "https://app.nuln.net", "/tower", undefined, "*");
    expect(redir).toBe("https://app.nuln.net/tower/admin/oidc/callback");

    // isSafeNextUrl
    expect(isSafeNextUrl("https://app.nuln.net/dashboard", "https://app.nuln.net", "")).toBe(true);
    expect(isSafeNextUrl("https://user:pass@app.nuln.net/dashboard", "https://app.nuln.net", "")).toBe(false);
  });
});
