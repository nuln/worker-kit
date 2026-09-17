import { describe, it, expect } from "vitest";
import {
  encryptJson,
  decryptJson,
  signHmacSha256,
  verifyHmacSha256,
  timingSafeEqual,
  randomToken,
  randomHex,
} from "../../src/crypto/index.js";


describe("[E2E Example] 08 - Zero-Trust Cryptographic Pipeline", () => {
  it("orchestrates authenticated JSON encryption, HMAC signature verification, and timing-safe equality", async () => {
    const MASTER_PASSWORD = "SuperSecureMasterPassword!2026";

    // 1. Encrypt sensitive object with AES-GCM
    const sensitiveData = {
      apiKey: "sk-live-987654321",
      privateKey: "-----BEGIN RSA PRIVATE KEY-----...",
      cardholder: "John Doe",
    };

    const encryptedBlob = await encryptJson(sensitiveData, MASTER_PASSWORD);
    expect(encryptedBlob).toContain(".");

    // 2. Decrypt payload and verify integrity
    const decryptedObj = await decryptJson<typeof sensitiveData>(encryptedBlob, MASTER_PASSWORD);
    expect(decryptedObj.apiKey).toBe("sk-live-987654321");
    expect(decryptedObj.cardholder).toBe("John Doe");

    // 3. Tampered ciphertext rejection (AEAD Authentication tag validation)
    const tamperedBlob = encryptedBlob.slice(0, -4) + "AAAA";
    await expect(decryptJson(tamperedBlob, MASTER_PASSWORD)).rejects.toThrow();

    // 4. Webhook HMAC-SHA256 Signature Verification
    const webhookSecret = "webhook_secret_key_123456";
    const webhookPayload = JSON.stringify({ event: "payment.succeeded", amount: 9900 });
    const signature = await signHmacSha256(webhookSecret, webhookPayload);

    const isValid = await verifyHmacSha256(webhookSecret, webhookPayload, signature);
    expect(isValid).toBe(true);

    const isForgedValid = await verifyHmacSha256(webhookSecret, webhookPayload, signature + "tampered");
    expect(isForgedValid).toBe(false);

    // 6. Timing-Safe Comparison against timing attacks
    expect(timingSafeEqual("fixed_token_value_123", "fixed_token_value_123")).toBe(true);
    expect(timingSafeEqual("fixed_token_value_123", "fixed_token_value_456")).toBe(false);
    expect(timingSafeEqual("short", "longer_token")).toBe(false);

    // 7. CSPRNG Token Generation
    const token = randomToken(32);
    expect(token.length).toBe(43);

    const hex = randomHex(32);
    expect(hex.length).toBe(32);
  });
});

