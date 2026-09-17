/**
 * Example 15: Microservice URL Registry & Dynamic Multi-Domain Routing
 *
 * Demonstrates:
 * 1. Resolving service endpoints across production and local dev ports
 * 2. Validating redirect URIs against security allowlists
 * 3. Selecting the closest matching WebAuthn RP_ID for multi-tenant domains
 */

import {
  normalizeOrigin,
  isLoopbackHostname,
  parseOriginAllowlist,
  validateRedirectUri,
  selectRpId,
} from "@nuln/worker-kit";

export function runUrlsExample() {
  console.log("=== [Example 15] Service URLs & Multi-Domain Registry ===");

  // 1. Origin allowlist parsing
  const allowlist = parseOriginAllowlist("https://app.nuln.net, https://admin.nuln.net");
  console.log("Parsed Origin Allowlist:", allowlist);

  // 2. Select RP ID for multi-domain Passkey authentication
  const matchedRpId = selectRpId("staging.admin.nuln.net", ["nuln.net", "other.com"]);
  console.log("Matched RP ID:", matchedRpId); // nuln.net

  // 3. Validate callback redirect URI
  const isValidRedirect = validateRedirectUri(
    "https://tower.nuln.net/callback\nhttps://mail.nuln.net/callback",
    "https://tower.nuln.net/callback"
  );
  console.log("Redirect URI Valid:", isValidRedirect);
}
