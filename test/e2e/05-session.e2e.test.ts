import { describe, it, expect } from "vitest";
import { formatSessionCookie, parseCookieValue, clearSessionCookie } from "../../src/session/index.js";
import { AuthSessionDO } from "../../src/session/do.js";

describe("[E2E Example] 05 - Edge Distributed Session & Stateful Cookie Management", () => {
  it("orchestrates signed session cookie issuing, verification, revocation, and Durable Object storage", async () => {
    // 1. Issue signed Session Cookie for logged-in user
    const token = "jwt_session_token_xyz_123456";

    const cookieHeader = formatSessionCookie("nuln_session", token, true, "/dashboard", 86400);

    expect(cookieHeader).toContain("nuln_session=jwt_session_token_xyz_123456");
    expect(cookieHeader).toContain("Max-Age=86400");
    expect(cookieHeader).toContain("SameSite=Lax");
    expect(cookieHeader).toContain("Secure");
    expect(cookieHeader).toContain("Path=/dashboard");

    // 2. Parse Session from incoming Cookie header
    const cookieVal = parseCookieValue(`other_pref=dark; nuln_session=${token}`, "nuln_session");
    expect(cookieVal).toBe(token);

    // 3. Ephemeral Durable Object session for one-time code exchange
    const doSession = new AuthSessionDO({}, {});
    await doSession.set("oauth_code:123456", JSON.stringify({ userId: "usr_super_123", scope: "read write" }), 60);

    // Atomically consume (take)
    const consumed = await doSession.take("oauth_code:123456");
    expect(consumed).toBeDefined();
    expect(JSON.parse(consumed!).userId).toBe("usr_super_123");

    // Secondary attempt must return null (Strictly-Once CAS)
    const secondTry = await doSession.take("oauth_code:123456");
    expect(secondTry).toBeNull();

    // 4. Logout / Clear Session Cookie
    const clearCookie = clearSessionCookie("nuln_session");
    expect(clearCookie).toContain("Max-Age=0");
  });
});

