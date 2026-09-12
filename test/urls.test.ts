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
  isSafeNextUrl,
} from "../src/urls/index.js";

describe("@nuln/worker-kit/urls", () => {
  it("normalizeOrigin: 去除尾斜杠与 query/hash", () => {
    expect(normalizeOrigin("https://auth.example.com/some/path?a=1#test")).toBe(
      "https://auth.example.com",
    );
  });

  it("isLoopbackHostname: 识别本地与局域网 IP", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("192.168.1.100")).toBe(true);
    expect(isLoopbackHostname("10.0.0.1")).toBe(true);
    expect(isLoopbackHostname("172.20.0.1")).toBe(true);
    expect(isLoopbackHostname("auth.example.com")).toBe(false);
  });

  it("normalizeSubPath: 规整子路径", () => {
    expect(normalizeSubPath("")).toBe("");
    expect(normalizeSubPath("/")).toBe("");
    expect(normalizeSubPath("/oidc/")).toBe("/oidc");
    expect(normalizeSubPath("oidc")).toBe("/oidc");
  });

  it("normalizeIssuerUrl: 规整 Issuer URL", () => {
    expect(normalizeIssuerUrl("https://auth.example.com/oidc/")).toBe(
      "https://auth.example.com/oidc",
    );
    expect(normalizeIssuerUrl("http://localhost:8787/")).toBe(
      "http://localhost:8787",
    );
  });

  it("parseOriginAllowlist: 正常解析与通配符", () => {
    expect(parseOriginAllowlist("*")).toEqual(["*"]);
    expect(
      parseOriginAllowlist(
        "https://app1.example.com, https://app2.example.com",
        "https://auth.example.com",
      ),
    ).toEqual([
      "https://app1.example.com",
      "https://app2.example.com",
      "https://auth.example.com",
    ]);
  });

  it("resolveIssuer: 集中模式 vs 动态同构模式", () => {
    // 集中绝对配置
    expect(
      resolveIssuer(
        "https://app.example.com/test",
        {
          AUTH_SERVER_URL: "https://auth.example.com/oidc",
          ORIGIN: "https://app.example.com",
        },
        "/oidc",
      ),
    ).toBe("https://auth.example.com/oidc");

    // 动态同构模式
    expect(
      resolveIssuer(
        "https://app.example.com/oidc/login",
        { ORIGIN: "https://app.example.com" },
        "/oidc",
      ),
    ).toBe("https://app.example.com/oidc");
  });

  it("normalizeRedirectUri & validateRedirectUri", () => {
    expect(normalizeRedirectUri("https://app.example.com/callback")).toBe(
      "https://app.example.com/callback",
    );
    expect(
      validateRedirectUri(
        JSON.stringify(["https://app.example.com/callback"]),
        "https://app.example.com/callback",
      ),
    ).toBe(true);
    expect(
      validateRedirectUri(
        "https://app.example.com/cb1 https://app.example.com/cb2",
        "https://app.example.com/cb2",
      ),
    ).toBe(true);
    expect(
      validateRedirectUri(
        "https://app.example.com/cb1",
        "https://evil.com/cb1",
      ),
    ).toBe(false);
  });

  it("selectRpId: 精确匹配与最长后缀匹配", () => {
    const list = ["example.com", "sub.example.com"];
    expect(selectRpId("sub.example.com", list)).toBe("sub.example.com");
    expect(selectRpId("deep.sub.example.com", list)).toBe("sub.example.com");
    expect(selectRpId("other.example.com", list)).toBe("example.com");
  });

  it("isSafeNextUrl: 防开放重定向攻击", () => {
    expect(
      isSafeNextUrl(
        "/oidc/dashboard",
        "https://app.example.com",
        "/oidc",
      ),
    ).toBe(true);
    expect(
      isSafeNextUrl(
        "https://evil.com/phish",
        "https://app.example.com",
        "/oidc",
      ),
    ).toBe(false);
    expect(
      isSafeNextUrl(
        "//evil.com",
        "https://app.example.com",
        "/oidc",
      ),
    ).toBe(false);
  });
});
