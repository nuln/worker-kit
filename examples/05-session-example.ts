/**
 * Example 05: Distributed Edge Session & State Management
 *
 * Demonstrates:
 * 1. Issuing signed, secure HttpOnly Session Cookies (Mode A / Mode B)
 * 2. Parsing cookie headers and extracting session credentials
 * 3. Utilizing AuthSessionDO (Durable Object) for strictly-once token exchange (CAS)
 * 4. Safe cookie revocation upon logout
 */

import {
  formatSessionCookie,
  parseCookieValue,
  clearSessionCookie,
  AuthSessionDO,
} from "@nuln/worker-kit";

export async function runSessionExample(request: Request) {
  console.log("=== [Example 05] Distributed Edge Session ===");

  // 1. Issue Session Cookie for 8 hours (28800s)
  const sessionToken = "jwt_session_token_example_123";
  const cookieHeader = formatSessionCookie("nuln_session", sessionToken, request, "/tower", 28800);
  console.log("Set-Cookie Header:", cookieHeader);

  // 2. Extract Session Cookie from incoming request
  const token = parseCookieValue(request.headers.get("Cookie"), "nuln_session");
  console.log("Extracted session token:", token);

  // 3. Ephemeral Durable Object session for one-time code exchange
  const doSession = new AuthSessionDO({}, {});
  await doSession.set("oauth_code:888", JSON.stringify({ userId: "usr_100", scope: "admin" }), 60);

  // Atomically consume (strictly once)
  const payload = await doSession.take("oauth_code:888");
  console.log("Consumed OAuth payload atomically:", payload);

  // 4. Logout / Clear Cookie
  const logoutHeader = clearSessionCookie("nuln_session", request, "/tower");
  console.log("Revocation Cookie Header:", logoutHeader);
}
