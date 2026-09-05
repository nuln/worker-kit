import { describe, it, expect } from "vitest";
import {
  normalizeOrigin,
  isLoopbackHostname,
  normalizeSubPath,
  normalizeIssuerUrl,
  parseOriginAllowlist,
  resolveIssuer,
  normalizeRedirectUri,
  validateRedirectUri,
  selectRpId,
  assertSsoOrigin,
  resolveOidcIssuer,
  resolveOidcRedirectUri,
  isSafeNextUrl,
} from "../src/sso/index";

describe("@nuln/worker-kit/sso", () => {
  it("normalizeOrigin: 去除默认端口与路径，仅保留 scheme://host", () => {
    expect(normalizeOrigin("https://a.com:443/oidc?foo=1#hash")).toBe("https://a.com");
    expect(normalizeOrigin("http://localhost:8787/")).toBe("http://localhost:8787");
  });

  it("isLoopbackHostname: 识别 localhost / 127.0.0.1 / ::1", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("a.com")).toBe(false);
  });

  it("normalizeIssuerUrl: 保全合法子路径", () => {
    expect(normalizeIssuerUrl("https://auth.com/oidc/")).toBe("https://auth.com/oidc");
    expect(normalizeIssuerUrl("https://auth.com/")).toBe("https://auth.com");
  });

  it("resolveIssuer: 命中白名单动态派生，未命中抛错 (fail-closed)", () => {
    const env = { ORIGIN: "https://a.com, https://b.com" };
    expect(resolveIssuer("https://a.com/oidc/authorize", env, "/oidc")).toBe("https://a.com/oidc");
    expect(resolveIssuer("https://b.com/oidc/authorize", env, "/oidc")).toBe("https://b.com/oidc");
    expect(() => resolveIssuer("https://evil.com/oidc/authorize", env, "/oidc")).toThrow(/invalid_host/);
  });

  it("validateRedirectUri: 支持多行与 JSON 数组精确匹配", () => {
    const allowed = "https://a.com/tower/admin/oidc/callback\nhttps://b.com/tower/admin/oidc/callback";
    expect(validateRedirectUri(allowed, "https://a.com/tower/admin/oidc/callback")).toBe(true);
    expect(validateRedirectUri(allowed, "https://a.com/tower/admin/oidc/callback/")).toBe(false);
    expect(validateRedirectUri(allowed, "https://evil.com/callback")).toBe(false);
  });

  it("selectRpId: 点边界匹配与最长匹配优先", () => {
    const rps = ["a.com", "sub.a.com", "localhost"];
    expect(selectRpId("a.com", rps)).toBe("a.com");
    expect(selectRpId("sub.a.com", rps)).toBe("sub.a.com");
    expect(selectRpId("node.sub.a.com", rps)).toBe("sub.a.com");
    expect(() => selectRpId("evila.com", rps)).toThrow(/invalid_rp_id/);
  });

  it("resolveOidcRedirectUri: 默认生成 /admin/oidc/callback", () => {
    expect(
      resolveOidcRedirectUri(undefined, "https://a.com/tower/login", "/tower", "/admin/oidc/callback", "https://a.com"),
    ).toBe("https://a.com/tower/admin/oidc/callback");
  });

  it("isSafeNextUrl: 校验同源与 basePath 范围", () => {
    expect(isSafeNextUrl("/tower", "https://a.com", "/tower")).toBe(true);
    expect(isSafeNextUrl("/tower/admin", "https://a.com", "/tower")).toBe(true);
    expect(isSafeNextUrl("/push", "https://a.com", "/tower")).toBe(false);
    expect(isSafeNextUrl("https://evil.com", "https://a.com", "/tower")).toBe(false);
  });
});
