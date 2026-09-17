/**
 * Example 03: Passkey First-Access Setup & WebAuthn Authentication
 *
 * Demonstrates:
 * 1. Checking site initialization state (Single Admin lock)
 * 2. Issuing WebAuthn registration challenge for hardware Passkey
 * 3. Verifying registration response and storing credential in D1
 * 4. Handling WebAuthn login and issuing signed HTTP session cookie
 */

import {
  handleSetupOptions,
  handleSetupVerify,
  handleLoginOptions,
  handleLoginVerify,
  authPageResponse,
} from "@nuln/worker-kit";

export async function handleAuthRouting(request: Request, env: any) {
  const url = new URL(request.url);

  // 1. SSR Setup / Login UI rendering
  if (url.pathname === "/setup" && request.method === "GET") {
    return authPageResponse({
      view: "setup",
      serviceName: "Tower",
      request,
      basePath: "/tower",
    });
  }

  // 2. Passkey Setup Challenge
  if (url.pathname === "/api/setup/options" && request.method === "POST") {
    return await handleSetupOptions(request, env, {
      serviceName: "Tower",
      rpId: url.hostname,
    });
  }

  // 3. Passkey Setup Verify
  if (url.pathname === "/api/setup/verify" && request.method === "POST") {
    return await handleSetupVerify(request, env, {
      serviceName: "Tower",
      rpId: url.hostname,
      origin: url.origin,
    });
  }
}
