import { describe, it, expect, vi } from "vitest";
import {
  discoverOidc,
  buildOidcAuthorizeUrl,
  exchangeOidcCode,
  fetchOidcUserInfo,
  parseJwtPayload,
} from "../src/sso/client.js";
import { PasskeyService } from "../src/auth/passkey.js";
import { renderLoginHtml, renderSetupHtml } from "../src/ui/auth-pages.js";
import { escapeHtml, formatBytes, errorResponse } from "../src/http/index.js";
import { toB64url } from "../src/crypto/index.js";

describe("worker-kit SSO Client, PasskeyService, and Auth UI Pages", () => {
  it("escapeHtml, formatBytes, and errorResponse work as expected", () => {
    expect(escapeHtml("<script>alert('xss')</script>")).toBe("&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1048576)).toBe("1 MB");

    const err = errorResponse("bad_request", 400, { field: "email" });
    expect(err.status).toBe(400);
  });

  it("OIDC client helpers: discoverOidc, buildOidcAuthorizeUrl, exchangeOidcCode, fetchOidcUserInfo, parseJwtPayload", async () => {
    // 1. buildOidcAuthorizeUrl
    const authUrl = buildOidcAuthorizeUrl({
      authorizationEndpoint: "https://auth.example.com/authorize",
      clientId: "my-client",
      redirectUri: "https://app.example.com/callback",
      state: "state_123",
      nonce: "nonce_456",
      codeChallenge: "chal_789",
    });
    expect(authUrl).toContain("response_type=code");
    expect(authUrl).toContain("client_id=my-client");
    expect(authUrl).toContain("code_challenge=chal_789");

    // 2. discoverOidc
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
        }),
      ),
    );
    const doc = await discoverOidc("https://auth.example.com", mockFetch as any);
    expect(doc.authorization_endpoint).toBe("https://auth.example.com/authorize");

    // 3. exchangeOidcCode
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "tok_123", token_type: "Bearer" })),
    );
    const tokens = await exchangeOidcCode({
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "my-client",
      clientSecret: "my-secret",
      code: "code_abc",
      redirectUri: "https://app.example.com/callback",
      fetchImpl: mockFetch as any,
    });
    expect(tokens.access_token).toBe("tok_123");

    // 4. fetchOidcUserInfo
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ sub: "user_123", email: "user@example.com" })),
    );
    const userinfo = await fetchOidcUserInfo({
      userinfoEndpoint: "https://auth.example.com/userinfo",
      accessToken: "tok_123",
      fetchImpl: mockFetch as any,
    });
    expect(userinfo.sub).toBe("user_123");
    expect(userinfo.email).toBe("user@example.com");

    // 5. parseJwtPayload
    const header = toB64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256" })));
    const payload = toB64url(new TextEncoder().encode(JSON.stringify({ sub: "jwt_sub", email: "jwt@test.com" })));
    const jwt = `${header}.${payload}.fake_signature`;
    const parsed = parseJwtPayload<{ sub: string; email: string }>(jwt);
    expect(parsed.sub).toBe("jwt_sub");
  });

  it("renderLoginHtml and renderSetupHtml generate valid HTML", () => {
    const loginHtml = renderLoginHtml({
      serviceName: "Tower",
      basePath: "/tower",
      needsSetup: true,
      oidcEnabled: true,
    });
    expect(loginHtml).toContain("Tower");
    expect(loginHtml).toContain("Passkey 快捷登录");
    expect(loginHtml).toContain("OIDC 单点登录");
    expect(loginHtml).toContain("/tower/setup");

    const setupHtml = renderSetupHtml({
      serviceName: "Tower",
      basePath: "/tower",
      defaultEmail: "admin@example.com",
    });
    expect(setupHtml).toContain("初始化超级管理员");
    expect(setupHtml).toContain("admin@example.com");
  });

  it("PasskeyService isInitialized and options generation with mock D1", async () => {
    const mockD1 = {
      prepare: vi.fn(() => ({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn(async () => ({ cnt: 0 })),
        run: vi.fn(async () => ({ success: true })),
      })),
    } as any;

    const passkeySvc = new PasskeyService({
      rpName: "Test Service",
      rpID: "localhost",
      origin: ["http://localhost:8788"],
    });

    const isInit = await passkeySvc.isInitialized(mockD1);
    expect(isInit).toBe(false);

    const setupOpt = await passkeySvc.generateSetupOptions(mockD1, "admin@test.com", "localhost:8788");
    expect(setupOpt.tmp).toBeDefined();
    expect(setupOpt.options).toBeDefined();

    const loginOpt = await passkeySvc.generateLoginOptions(mockD1, "localhost:8788");
    expect(loginOpt.tmp).toBeDefined();
  });
});
