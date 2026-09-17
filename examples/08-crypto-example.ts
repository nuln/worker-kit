/**
 * Example 08: Zero-Trust Cryptographic Pipeline
 *
 * Demonstrates:
 * 1. AES-GCM-256 authenticated encryption & decryption for sensitive objects
 * 2. HMAC-SHA256 signature generation and constant-time verification (Webhooks)
 * 3. Timing-safe equality comparison against timing side-channel attacks
 * 4. CSPRNG secure random token generation
 */

import {
  encryptJson,
  decryptJson,
  signHmacSha256,
  verifyHmacSha256,
  timingSafeEqual,
  randomToken,
  randomHex,
} from "@nuln/worker-kit";

export async function runCryptoExample() {
  console.log("=== [Example 08] Zero-Trust Cryptographic Toolkit ===");

  const MASTER_KEY = "Sup3rS3cur3M4st3rK3y!2026";

  // 1. AES-GCM Encrypt & Decrypt JSON
  const credentials = { apiKey: "sk_live_998877", secret: "super_secret_token" };
  const encrypted = await encryptJson(credentials, MASTER_KEY);
  console.log("Encrypted Blob:", encrypted);

  const decrypted = await decryptJson<typeof credentials>(encrypted, MASTER_KEY);
  console.log("Decrypted API Key:", decrypted.apiKey);

  // 2. HMAC-SHA256 Webhook Signing
  const webhookSecret = "whsec_live_abcdef123456";
  const payload = JSON.stringify({ event: "order.paid", amount: 19900 });
  const signature = await signHmacSha256(webhookSecret, payload);
  console.log("HMAC Signature:", signature);

  const isValid = await verifyHmacSha256(webhookSecret, payload, signature);
  console.log("Webhook Signature Valid:", isValid);

  // 3. Timing Safe Comparison & Secure Tokens
  console.log("Tokens Equal:", timingSafeEqual("token_123", "token_123"));
  console.log("Random Hex Token (32 chars):", randomHex(32));
  console.log("Random Base64url Token:", randomToken(24));
}
