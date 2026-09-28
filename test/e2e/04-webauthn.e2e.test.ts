import { describe, it, expect } from "vitest";
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  resolveAAGUID,
  normalizeAaguid,
  resolveExpectedOrigins,
  resolveExpectedRPIDs,
} from "../../src/webauthn/index.js";

describe("[E2E Example] 04 - WebAuthn Protocol & Hardware Authenticator Identification", () => {
  it("orchestrates WebAuthn challenge generation, multi-device origin resolution, and hardware branding", async () => {
    // 1. Generate Registration Options
    const regOptions = await generateRegistrationOptions({
      rpName: "Nuln Infrastructure",
      rpID: "infra.nuln.net",
      userName: "dev@nuln.net",
      userID: new Uint8Array([1, 2, 3]) as any,
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    });

    expect(regOptions.challenge).toBeDefined();
    expect(regOptions.rp.name).toBe("Nuln Infrastructure");

    // 2. Multi-Device Origin and RPID resolution
    const origins = resolveExpectedOrigins(["https://infra.nuln.net"], "https://staging.infra.nuln.net");
    expect(origins).toContain("https://infra.nuln.net");
    expect(origins).toContain("https://staging.infra.nuln.net");

    const rpids = resolveExpectedRPIDs(["infra.nuln.net"], "infra.nuln.net");
    expect(rpids).toContain("infra.nuln.net");

    // 3. Hardware Authenticator Fingerprint & Brand Recognition
    // Apple Passkey
    const appleAaguid = normalizeAaguid("df53664a-2f40-4279-8ad4-1c620406087d");
    const appleBrand = resolveAAGUID(appleAaguid);
    expect(appleBrand.brand).toBe("apple");
    expect(appleBrand.iconType).toBe("apple");

    // YubiKey 5 Series
    const yubiAaguid = normalizeAaguid("cb69481e-8ff7-4039-93ec-0a2729a1d67b");
    const yubiBrand = resolveAAGUID(yubiAaguid);
    expect(yubiBrand.brand).toBe("yubico");
    expect(yubiBrand.iconType).toBe("yubikey");

    // Windows Hello
    const winAaguid = normalizeAaguid("08987058-cadc-4b81-b6e1-30de50dcbe96");
    const winBrand = resolveAAGUID(winAaguid);
    expect(winBrand.brand).toBe("microsoft");
    expect(winBrand.iconType).toBe("windows");

    // 4. Generate Auth Options
    const authOpts = await generateAuthenticationOptions({
      rpID: "infra.nuln.net",
      allowCredentials: [{ id: "cred_123" }],
    });
    expect(authOpts.challenge).toBeDefined();
    expect(authOpts.allowCredentials?.length).toBe(1);
  });
});

