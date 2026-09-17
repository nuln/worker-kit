import { describe, it, expect } from "vitest";
import {
  resolveIssuer,
  normalizeOrigin,
  normalizeRedirectUri,
  validateRedirectUri,
  selectRpId,
  isSafeNextUrl,
  assertSsoOrigin,
} from "../../src/urls/index.js";

describe("[E2E Example] 15 - Microservice Ecosystem Unified URL & Dynamic Routing Matrix", () => {
  it("resolves dynamic IdP issuer, validates redirect URIs, selects RP_ID, and secures next URL redirects", () => {
    // 1. Dynamic Issuer resolution (IdP side)
    const reqUrl = "https://auth.nuln.net/oidc/authorize?client_id=123";
    const issuer = resolveIssuer(reqUrl, { ORIGIN: "https://auth.nuln.net" }, "/oidc");
    expect(issuer).toBe("https://auth.nuln.net/oidc");

    // 2. Normalize Origin
    expect(normalizeOrigin("https://auth.nuln.net:8443/some/path?query=1")).toBe("https://auth.nuln.net:8443");

    // 3. Normalize & Validate Redirect URIs
    const allowedUris = "https://app.nuln.net/callback, https://app.nuln.net/auth/done";
    expect(validateRedirectUri(allowedUris, "https://app.nuln.net/callback")).toBe(true);
    expect(validateRedirectUri(allowedUris, "https://attacker.com/steal")).toBe(false);

    // 4. Select RP_ID
    const rpId = selectRpId("tower.nuln.net", ["nuln.net", "other.com"]);
    expect(rpId).toBe("nuln.net");

    // 5. Safe Next URL Redirection (Prevent open redirect)
    expect(isSafeNextUrl("/tower/dashboard", "https://tower.nuln.net", "/tower")).toBe(true);
    expect(isSafeNextUrl("https://evil.com", "https://tower.nuln.net", "/tower")).toBe(false);

    // 6. SSO Origin assertion
    expect(assertSsoOrigin("https://mail.nuln.net", ["https://mail.nuln.net", "https://tower.nuln.net"])).toBe(true);
    expect(assertSsoOrigin("https://unknown.com", ["https://mail.nuln.net"])).toBe(false);
  });
});
