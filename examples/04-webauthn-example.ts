/**
 * Example 04: WebAuthn Protocol & Hardware Authenticator Branding
 *
 * Demonstrates:
 * 1. Generating challenge options compliant with FIDO2 / WebAuthn Level 3
 * 2. Identifying hardware authenticator vendors via AAGUID (Apple, YubiKey, Windows Hello, 1Password)
 * 3. Resolving expected origins and RP IDs across multi-domain setups
 */

import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  resolveAAGUID,
  resolveExpectedOrigins,
} from "@nuln/worker-kit";

export async function runWebAuthnExample() {
  console.log("=== [Example 04] WebAuthn & Hardware Authenticator Branding ===");

  // 1. Generate registration options
  const options = await generateRegistrationOptions({
    rpName: "Nuln Security Center",
    rpID: "infra.nuln.net",
    userName: "admin@nuln.net",
    userID: new Uint8Array([1, 2, 3, 4, 5]) as any,
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
  });

  console.log("Challenge issued:", options.challenge);

  // 2. Identify Authenticator from AAGUID
  const yubikeyAaguid = "cb69481e-8ff7-4039-93ec-0a2729a1d67b";
  const brand = resolveAAGUID(yubikeyAaguid);
  console.log(`Detected Hardware: ${brand.name} (Brand: ${brand.brand}, Icon: ${brand.iconType})`);

  // 3. Multi-origin resolution
  const origins = resolveExpectedOrigins(["https://infra.nuln.net"], "https://infra.nuln.net");
  console.log("Allowed RP Origins:", origins);
}
