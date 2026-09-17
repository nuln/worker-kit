import { describe, it, expect } from "vitest";
import {
  isLocalhost,
  resolveRpID,
  resolveExpectedRPIDs,
  resolveExpectedOrigins,
  normalizeAttestationObject,
  safeParseTransports,
} from "../src/webauthn/index.js";

describe("@nuln/worker-kit/webauthn", () => {
  it("isLocalhost & resolveRpID: 本地与生产多域名解析", () => {
    expect(isLocalhost("localhost")).toBe(true);
    expect(isLocalhost("127.0.0.1")).toBe(true);
    expect(isLocalhost("auth.nuln.dev")).toBe(false);

    expect(resolveRpID("localhost", "localhost:8787")).toBe("localhost");
    expect(resolveRpID("127.0.0.1", "127.0.0.1:8787")).toBe("127.0.0.1");
    expect(resolveRpID(["nuln.dev", "nuln.app"], "auth.nuln.dev")).toBe("nuln.dev");
    expect(resolveRpID([], "auth.custom.com")).toBe("auth.custom.com");
  });

  it("resolveExpectedRPIDs & resolveExpectedOrigins: 多源判定", () => {
    const rpids = resolveExpectedRPIDs(["nuln.dev"], "auth.nuln.dev");
    expect(rpids).toContain("nuln.dev");
    expect(rpids).toContain("auth.nuln.dev");

    const origins = resolveExpectedOrigins(["https://nuln.dev"], "https://auth.nuln.dev");
    expect(origins).toContain("https://nuln.dev");
    expect(origins).toContain("https://auth.nuln.dev");
  });

  it("normalizeAttestationObject: 格式容错", () => {
    // 非法或非 CBOR Map 应原样返回不报错
    expect(normalizeAttestationObject("invalid-b64-string")).toBe("invalid-b64-string");
  });

  it("safeParseTransports: JSON 容错解析", () => {
    expect(safeParseTransports('["internal", "hybrid"]')).toEqual(["internal", "hybrid"]);
    expect(safeParseTransports(null)).toBeUndefined();
    expect(safeParseTransports("invalid json")).toBeUndefined();
  });

  it("normalizeAaguid & resolveAAGUID: 品牌识别与格式化", async () => {
    const { normalizeAaguid, resolveAAGUID } = await import("../src/webauthn/index.js");

    expect(normalizeAaguid(null)).toBe("00000000-0000-0000-0000-000000000000");
    expect(normalizeAaguid("DD48362D-0FD5-46A4-9844-486001A1D953")).toBe("dd48362d-0fd5-46a4-9844-486001a1d953");
    expect(normalizeAaguid("08987058cadc4b81b6e130de50dcbe96")).toBe("08987058-cadc-4b81-b6e1-30de50dcbe96");

    const appleInfo = resolveAAGUID("dd48362d-0fd5-46a4-9844-486001a1d953");
    expect(appleInfo.brand).toBe("apple");
    expect(appleInfo.name).toContain("Apple");
    expect(appleInfo.iconType).toBe("apple");

    const yubikeyInfo = resolveAAGUID("ee882879-721c-4916-ad96-be05544e98fb");
    expect(yubikeyInfo.brand).toBe("yubico");
    expect(yubikeyInfo.name).toContain("YubiKey");
    expect(yubikeyInfo.iconType).toBe("yubikey");

    const winHelloInfo = resolveAAGUID("6028b012-b052-4a08-8316-728419bc4f31");
    expect(winHelloInfo.brand).toBe("microsoft");
    expect(winHelloInfo.name).toContain("Windows Hello");

    const genericInfo = resolveAAGUID("12345678-1234-1234-1234-123456789abc");
    expect(genericInfo.brand).toBe("generic");
    expect(genericInfo.iconType).toBe("key");

    const bytes = new Uint8Array(16);
    bytes[0] = 0xee;
    bytes[1] = 0x88;
    expect(normalizeAaguid(bytes).startsWith("ee88")).toBe(true);
    expect(normalizeAaguid(new Uint8Array(5))).toBe("00000000-0000-0000-0000-000000000000");
  });
});
