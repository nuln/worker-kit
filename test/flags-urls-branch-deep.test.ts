import { describe, it, expect } from "vitest";
import {
  hasEnv,
  getEnvValue,
  maskSecretValue,
  resolveEnvConfigs,
  ConfigMemoryCache,
  type EnvConfigDefinition,
} from "../src/flags/index.js";
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
  assertSsoOrigin,
} from "../src/urls/index.js";

describe("Flags & URLs Module - Deep Branch Coverage", () => {
  it("covers flags hasEnv, getEnvValue, maskSecretValue, and resolveEnvConfigs", () => {
    const envObj = {
      AUTH_SECRET: "1234567890abcdef",
      SHORT_KEY: "1234",
      EMPTY_KEY: "   ",
    };

    expect(hasEnv(envObj, "auth_secret")).toBe(true);
    expect(hasEnv(envObj, "SHORT_KEY")).toBe(true);
    expect(hasEnv(envObj, "EMPTY_KEY")).toBe(false);
    expect(hasEnv(envObj, "NON_EXISTENT")).toBe(false);
    expect(hasEnv(null, "ANY")).toBe(false);

    expect(getEnvValue(envObj, "AUTH_SECRET")).toBe("1234567890abcdef");
    expect(getEnvValue(envObj, "EMPTY_KEY")).toBeUndefined();
    expect(getEnvValue(null, "AUTH_SECRET")).toBeUndefined();

    expect(maskSecretValue("")).toBe("");
    expect(maskSecretValue("12345678")).toBe("••••");
    expect(maskSecretValue("1234567890abcdef")).toBe("1234••••cdef");

    const defs: EnvConfigDefinition[] = [
      { key: "AUTH_SECRET", name: "Auth Secret", description: "Secret", isSecret: true, category: "Security" },
      { key: "SITE_NAME", name: "Site Name", description: "Name", defaultValue: "DefaultSite", category: "General" },
      { key: "OVERRIDDEN_KEY", name: "Override", description: "Desc", defaultValue: "Initial", category: "General" },
    ];

    const resolved = resolveEnvConfigs(defs, envObj, { OVERRIDDEN_KEY: "CustomOverride" });
    expect(resolved).toHaveLength(3);
    expect(resolved[0].isLocked).toBe(true);
    expect(resolved[0].maskedValue).toBe("1234••••cdef");
    expect(resolved[1].value).toBe("DefaultSite");
    expect(resolved[1].source).toBe("default");
    expect(resolved[2].value).toBe("CustomOverride");
    expect(resolved[2].source).toBe("env");
  });

  it("covers ConfigMemoryCache getOrFetch, set, and clear", async () => {
    const cache = new ConfigMemoryCache<string>(500);
    let fetchCount = 0;
    const fetcher = async () => {
      fetchCount++;
      return `result_${fetchCount}`;
    };

    const r1 = await cache.getOrFetch(fetcher);
    expect(r1).toBe("result_1");
    expect(fetchCount).toBe(1);

    // Cached result
    const r2 = await cache.getOrFetch(fetcher);
    expect(r2).toBe("result_1");
    expect(fetchCount).toBe(1);

    // Force fetch
    const r3 = await cache.getOrFetch(fetcher, true);
    expect(r3).toBe("result_2");
    expect(fetchCount).toBe(2);

    cache.set("manual_set");
    expect(await cache.getOrFetch(fetcher)).toBe("manual_set");

    cache.clear();
    const r4 = await cache.getOrFetch(fetcher);
    expect(r4).toBe("result_3");
  });

  it("covers URLs module: normalizeOrigin, isLoopbackHostname, normalizeSubPath, normalizeIssuerUrl", () => {
    expect(normalizeOrigin("https://nuln.net/path?q=1#hash")).toBe("https://nuln.net");
    expect(() => normalizeOrigin("https://user:pass@nuln.net")).toThrow("invalid_origin_userinfo");

    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("192.168.1.10")).toBe(true);
    expect(isLoopbackHostname("10.0.0.5")).toBe(true);
    expect(isLoopbackHostname("172.20.0.1")).toBe(true);
    expect(isLoopbackHostname("nuln.net")).toBe(false);

    expect(normalizeSubPath("/api/v1/")).toBe("/api/v1");
    expect(normalizeSubPath("")).toBe("");
    expect(normalizeSubPath("/")).toBe("");

    expect(normalizeIssuerUrl("https://auth.nuln.net/oidc/")).toBe("https://auth.nuln.net/oidc");
    expect(normalizeIssuerUrl("http://localhost:8787/oidc")).toBe("http://localhost:8787/oidc");
    expect(() => normalizeIssuerUrl("http://insecure.nuln.net")).toThrow("invalid_issuer_protocol");
    expect(() => normalizeIssuerUrl("https://user:pass@auth.nuln.net")).toThrow("invalid_issuer_userinfo");
  });

  it("covers parseOriginAllowlist, resolveIssuer, and selectRpId", () => {
    const list = parseOriginAllowlist("https://app.nuln.net, https://admin.nuln.net", "https://default.nuln.net");
    expect(list).toContain("https://app.nuln.net");
    expect(list).toContain("https://admin.nuln.net");
    expect(list).toContain("https://default.nuln.net");
    expect(parseOriginAllowlist("*")).toEqual(["*"]);

    // resolveIssuer with wildcard allowlist
    const issuer1 = resolveIssuer("https://custom.nuln.net/oidc", { ORIGIN: "*" }, "/oidc");
    expect(issuer1).toBe("https://custom.nuln.net/oidc");

    // resolveIssuer with absolute AUTH_SERVER_URL
    const issuer2 = resolveIssuer("https://custom.nuln.net/oidc", {
      AUTH_SERVER_URL: "https://auth.central.nuln.net/sso",
      ORIGIN: "https://custom.nuln.net",
    }, "/oidc");
    expect(issuer2).toBe("https://auth.central.nuln.net/sso");

    // RP ID selection
    expect(selectRpId("app.nuln.net", ["nuln.net", "other.com"])).toBe("nuln.net");
    expect(selectRpId("exact.nuln.net", ["exact.nuln.net", "nuln.net"])).toBe("exact.nuln.net");
    expect(() => selectRpId("192.168.1.1", ["nuln.net"])).toThrow("invalid_rp_id");

    // isSafeNextUrl
    expect(isSafeNextUrl("/dashboard", "https://app.nuln.net", "/")).toBe(true);
    expect(isSafeNextUrl("https://evil.com", "https://app.nuln.net", "/")).toBe(false);
    expect(isSafeNextUrl("", "https://app.nuln.net", "/")).toBe(false);

    // assertSsoOrigin
    expect(assertSsoOrigin("https://app.nuln.net", ["https://app.nuln.net"])).toBe(true);
    expect(assertSsoOrigin("https://app.nuln.net", ["*"])).toBe(true);
  });
});
