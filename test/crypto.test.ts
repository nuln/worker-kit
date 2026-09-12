import { describe, it, expect } from "vitest";
import {
  sha256,
  sha256Hex,
  safeEqual,
  randomToken,
  randomHex,
  randomB64url,
  hmacHex,
  signHmacSha256,
  verifyHmacSha256,
  toB64url,
  fromB64url,
  encryptJson,
  decryptJson,
  encryptSecret,
  decryptSecret,
  hashPassword,
  verifyPassword,
} from "../src/crypto/index.js";

describe("@nuln/worker-kit/crypto", () => {
  it("toB64url & fromB64url: 双向互转一致性", () => {
    const original = new Uint8Array([0, 1, 2, 255, 254, 128, 64]);
    const b64 = toB64url(original);
    expect(b64).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded = fromB64url(b64);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

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

  it("randomToken & randomHex & randomB64url", () => {
    const t = randomToken(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    const h = randomHex(32);
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    const b = randomB64url(32);
    expect(b).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hmacHex & signHmacSha256 & verifyHmacSha256", async () => {
    const secret = "super-secret-key-123456";
    const data = "hello world payload";
    const hexSig = await hmacHex(secret, data);
    expect(hexSig).toMatch(/^[0-9a-f]{64}$/);

    const b64Sig = await signHmacSha256(secret, data);
    expect(b64Sig).toMatch(/^[A-Za-z0-9_-]+$/);

    expect(await verifyHmacSha256(secret, data, b64Sig)).toBe(true);
    expect(await verifyHmacSha256(secret, "tampered", b64Sig)).toBe(false);
    expect(await verifyHmacSha256("wrong-key", data, b64Sig)).toBe(false);
  });

  it("encryptJson & decryptJson (AES-GCM-256)", async () => {
    const passphrase = "encryption-master-passphrase";
    const sensitiveData = {
      apiKey: "sk_live_123456789",
      roles: ["admin", "superadmin"],
      count: 42,
    };
    const encrypted = await encryptJson(sensitiveData, passphrase);
    expect(encrypted).toContain(".");
    const decrypted = await decryptJson<typeof sensitiveData>(encrypted, passphrase);
    expect(decrypted).toEqual(sensitiveData);

    // 错误密码解密应抛出异常
    await expect(decryptJson(encrypted, "wrong-passphrase")).rejects.toThrow();
  });

  it("encryptSecret & decryptSecret", async () => {
    const passphrase = "passphrase-key";
    const secret = "my_plain_text_secret";
    const blob = await encryptSecret(secret, passphrase);
    const plain = await decryptSecret(blob, passphrase);
    expect(plain).toBe(secret);
  });

  it("hashPassword & verifyPassword (PBKDF2)", async () => {
    const password = "UserSecurePassword@2026";
    const hash = await hashPassword(password, 1000); // 1000 iter for fast test
    expect(hash).toMatch(/^pbkdf2:sha256:1000:/);

    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword("WrongPassword", hash)).toBe(false);
  });
});
