import { describe, it, expect } from "vitest";
import {
  sha256,
  sha256Hex,
  safeEqual,
  randomToken,
  randomB64url,
  hmacHex,
} from "../src/crypto/index";

describe("@nuln/worker-kit/crypto", () => {
  it("sha256Hex: 已知向量", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("sha256: 返回 32 字节", async () => {
    expect((await sha256("abc")).length).toBe(32);
  });

  it("safeEqual: 等长比较与长度不等拒绝", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("randomToken: 指定长度十六进制", () => {
    const t = randomToken(32);
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(randomToken(32)).not.toBe(randomToken(32));
  });

  it("randomB64url: URL 安全无填充", () => {
    expect(randomB64url(32)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hmacHex: 确定性 64 位十六进制", async () => {
    const a = await hmacHex("secret", "data");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hmacHex("secret", "data")).toBe(a);
    expect(await hmacHex("other", "data")).not.toBe(a);
  });
});
