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
});
