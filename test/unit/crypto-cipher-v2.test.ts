/**
 * 存储加密格式（`v2`）回归测试。
 *
 * ## 为什么需要独立测试
 *
 * 密钥派生从「单轮无盐 SHA-256」升级为「PBKDF2-HMAC-SHA256 + 每记录随机盐」，
 * 密文格式随之从 `<iv>.<ct>` 变为 `v2.<salt>.<iv>.<ct>`。这是**数据格式变更**，
 * 必须同时保证两件事：
 *
 * 1. 新写入一律使用 `v2`（加盐、可抵抗彩虹表与多目标攻击）
 * 2. 存量 `<iv>.<ct>` 密文**仍可解密** —— 否则升级即等于数据丢失
 *
 * 另需锁定若干边界：尾随段不得被静默忽略、错误口令必须 fail-closed、
 * 派生密钥不可导出。
 */

import { describe, it, expect } from "vitest";
import {
  encryptJson,
  decryptJson,
  encryptSecret,
  decryptSecret,
  deriveKey,
  toB64url,
  KDF_ITERATIONS,
} from "../../src/crypto/index.js";

/** 构造一条遗留格式（单轮 SHA-256 派生）的密文，用于验证向后兼容。 */
async function makeLegacyBlob(value: unknown, passphrase: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(passphrase) as BufferSource,
  );
  const key = await crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, [
    "encrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(value)) as BufferSource,
  );
  return `${toB64url(iv)}.${toB64url(ct)}`;
}

describe("存储加密 v2：PBKDF2 加盐派生", () => {
  it("新写入使用 v2 前缀与 4 段结构", async () => {
    const blob = await encryptJson({ secret: "s3cr3t" }, "passphrase");
    expect(blob.startsWith("v2.")).toBe(true);
    expect(blob.split(".")).toHaveLength(4);
  });

  it("v2 往返一致", async () => {
    const blob = await encryptJson({ secret: "s3cr3t" }, "passphrase");
    expect(await decryptJson(blob, "passphrase")).toEqual({ secret: "s3cr3t" });
  });

  it("encryptSecret / decryptSecret 走同一格式", async () => {
    const blob = await encryptSecret("token-abc", "passphrase");
    expect(blob.startsWith("v2.")).toBe(true);
    expect(await decryptSecret(blob, "passphrase")).toBe("token-abc");
  });

  it("每条记录独立盐：同口令同明文产生不同密文", async () => {
    const a = await encryptJson("same", "passphrase");
    const b = await encryptJson("same", "passphrase");
    expect(a).not.toBe(b);
    // 两者都必须能用自己的盐解开
    expect(await decryptJson(a, "passphrase")).toBe("same");
    expect(await decryptJson(b, "passphrase")).toBe("same");
  });

  it("错误口令 fail-closed（GCM 认证失败）", async () => {
    const blob = await encryptJson("data", "right-passphrase");
    await expect(decryptJson(blob, "wrong-passphrase")).rejects.toThrow();
  });
});

describe("存储加密 v2：向后兼容", () => {
  it("存量 <iv>.<ct> 遗留密文仍可解密", async () => {
    const legacy = await makeLegacyBlob({ old: true }, "passphrase");
    expect(legacy.split(".")).toHaveLength(2);
    expect(await decryptJson(legacy, "passphrase")).toEqual({ old: true });
  });

  it("遗留密文的错误口令同样 fail-closed", async () => {
    const legacy = await makeLegacyBlob({ old: true }, "passphrase");
    await expect(decryptJson(legacy, "nope")).rejects.toThrow();
  });
});

describe("存储加密 v2：格式边界", () => {
  it("尾随多余段被拒绝，不再静默忽略", async () => {
    const blob = await encryptJson("data", "passphrase");
    // 历史实现用 split(".") 取前两段，`blob + ".garbage"` 会被正常解密，
    // 从而掩盖双重编码一类的数据完整性问题。
    await expect(decryptJson(`${blob}.garbage`, "passphrase")).rejects.toThrow(
      "bad encrypted blob",
    );
  });

  it("段数为 3（既非 2 也非 4）被拒绝", async () => {
    await expect(decryptJson("v2.aaa.bbb", "passphrase")).rejects.toThrow(
      "bad encrypted blob",
    );
    await expect(decryptJson("a.b.c", "passphrase")).rejects.toThrow("bad encrypted blob");
  });

  it("空段被拒绝", async () => {
    await expect(decryptJson("v2..b.c", "passphrase")).rejects.toThrow("bad encrypted blob");
  });
});

describe("deriveKey", () => {
  it("派生密钥不可导出（extractable=false）", async () => {
    const key = await deriveKey("passphrase", new Uint8Array(16));
    expect(key.extractable).toBe(false);
    expect(key.algorithm.name).toBe("AES-GCM");
  });

  it("盐参与密钥派生：同盐可解、异盐不可解", async () => {
    const saltA = new Uint8Array(16).fill(7);
    const saltB = new Uint8Array(16).fill(9);
    const pt = new TextEncoder().encode("hi") as BufferSource;
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // 用 saltA 加密
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await deriveKey("p", saltA),
      pt,
    );

    // 同盐 + 同口令 → 同一密钥，可解密
    const opened = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      await deriveKey("p", saltA),
      ct,
    );
    expect(new TextDecoder().decode(opened)).toBe("hi");

    // 异盐 → 密钥不同，GCM 认证失败
    await expect(
      crypto.subtle.decrypt({ name: "AES-GCM", iv }, await deriveKey("p", saltB), ct),
    ).rejects.toThrow();
  });

  it("默认迭代次数为 KDF_ITERATIONS", () => {
    expect(KDF_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });
});
