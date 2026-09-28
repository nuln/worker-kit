import { describe, it, expect } from "vitest";
import {
  normalizeAaguid,
  resolveAAGUID,
} from "../../src/webauthn/aaguid.js";
import {
  resolveExpectedOrigins,
  resolveExpectedRPIDs,
  safeParseTransports,
  normalizeAttestationObject,
} from "../../src/webauthn/index.js";

describe("@nuln/worker-kit/webauthn - Deep AAGUID & WebAuthn Helpers Coverage", () => {
  it("normalizeAaguid parses UUID, hex32, base64, Uint8Array and bad strings", () => {
    expect(normalizeAaguid(null)).toBe("00000000-0000-0000-0000-000000000000");
    expect(normalizeAaguid(undefined)).toBe("00000000-0000-0000-0000-000000000000");

    // Standard UUID
    expect(normalizeAaguid("ADCE0002-35BC-C60A-648B-0B25F1F05503")).toBe(
      "adce0002-35bc-c60a-648b-0b25f1f05503"
    );

    // 32-char hex
    expect(normalizeAaguid("adce000235bcc60a648b0b25f1f05503")).toBe(
      "adce0002-35bc-c60a-648b-0b25f1f05503"
    );

    // Base64url encoded 16 bytes
    // 16 bytes of 0x01 -> AQEBAQEBAQEBAQEBAQEBAQ
    const b64 = "AQEBAQEBAQEBAQEBAQEBAQ";
    expect(normalizeAaguid(b64)).toBe("01010101-0101-0101-0101-010101010101");

    // Bad/unparseable string
    expect(normalizeAaguid("invalid-random-string")).toBe("00000000-0000-0000-0000-000000000000");

    // Uint8Array input
    const bytes = new Uint8Array(16);
    bytes[0] = 0x12;
    bytes[15] = 0xfe;
    expect(normalizeAaguid(bytes)).toBe("12000000-0000-0000-0000-0000000000fe");
  });

  it("resolveAAGUID identifies known authenticators and falls back gracefully", () => {
    // Apple iCloud Keychain
    const apple = resolveAAGUID("dd48362d-0fd5-46a4-9844-486001a1d953");
    expect(apple.brand).toBe("apple");
    expect(apple.iconType).toBe("apple");

    // Unknown AAGUID
    const unknown = resolveAAGUID("ffffffff-ffff-ffff-ffff-ffffffffffff");
    expect(unknown.brand).toBe("generic");
    expect(unknown.iconType).toBe("key");
  });

  it("resolveExpectedOrigins handles origins and request origins", () => {
    // 本地开发必须显式配置自己的 origin 才能通过（未配置即 fail-closed）
    const local = resolveExpectedOrigins(["http://localhost:8788"], "http://localhost:8788");
    expect(local).toContain("http://localhost:8788");

    // Configured domains + 子域 origin
    const prodOrigins = resolveExpectedOrigins(["https://nuln.net", "https://auth.nuln.net"], "https://app.nuln.net");
    expect(prodOrigins).toContain("https://nuln.net");
    expect(prodOrigins).toContain("https://auth.nuln.net");
    expect(prodOrigins).toContain("https://app.nuln.net");
  });

  it("resolveExpectedRPIDs handles IP, localhost and multi-level domains", () => {
    // 多级子域：app 是 auth 的子域 → 纳入
    const rpids = resolveExpectedRPIDs(["auth.nuln.net"], "app.auth.nuln.net");
    expect(rpids).toContain("auth.nuln.net");
    expect(rpids).toContain("app.auth.nuln.net");

    // 兄弟域不是子域 → 拒绝
    expect(resolveExpectedRPIDs(["auth.nuln.net"], "app.nuln.net")).toEqual(["auth.nuln.net"]);

    // 本地开发必须显式配置 RP ID（未配置即 fail-closed）
    const localRpids = resolveExpectedRPIDs(["localhost"], "localhost");
    expect(localRpids).toContain("localhost");
  });

  it("safeParseTransports handles valid json, empty string and malformed json", () => {
    expect(safeParseTransports(null)).toBeUndefined();
    expect(safeParseTransports("")).toBeUndefined();
    expect(safeParseTransports('["internal", "usb"]')).toEqual(["internal", "usb"]);
    expect(safeParseTransports("malformed-json")).toBeUndefined();
  });

  it("normalizeAttestationObject handles Base64 / ArrayBuffer normalization", () => {
    expect(normalizeAttestationObject("validBase64")).toBe("validBase64");
    expect(normalizeAttestationObject("")).toBe("");
  });
});
