/**
 * @nuln/worker-kit/auth/passkey
 *
 * 统一 D1 / SQLite 原生 WebAuthn / Passkey 认证与管理服务
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  normalizeAttestationObject,
  resolveRpID,
  resolveExpectedRPIDs,
  resolveExpectedOrigins,
  safeParseTransports,
  type WebAuthnConfig,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "../webauthn/index.js";
import { fromB64url, toB64url, randomToken } from "../crypto/index.js";

export interface PasskeyRecord {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: Uint8Array | string;
  counter: number;
  transports?: string | null;
  name: string;
  aaguid?: string | null;
  createdAt?: string | number | Date;
  lastUsedAt?: string | number | Date;
}

export class PasskeyService {
  constructor(protected config: WebAuthnConfig) {}

  /** 检查系统是否已存在任何已激活的 Passkey 凭据（用于判断是否需要首屏引导初始化）。 */
  async isInitialized(db: D1Database): Promise<boolean> {
    try {
      const res = await db.prepare("SELECT count(*) as cnt FROM passkey_credentials").first<{ cnt: number }>();
      return (res?.cnt ?? 0) > 0;
    } catch {
      return false;
    }
  }

  /** 生成初始化 / 注册 Passkey 的 Challenge 与 Options。 */
  async generateSetupOptions(
    db: D1Database,
    email: string,
    reqHost?: string,
  ): Promise<{ tmp: string; options: unknown }> {
    const effectiveRpID = resolveRpID(this.config.rpID, reqHost);
    const userId = new TextEncoder().encode(email);
    const options = await generateRegistrationOptions({
      rpName: this.config.rpName,
      rpID: effectiveRpID,
      userName: email,
      userID: userId,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });

    const tmp = randomToken(16);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await db
      .prepare(
        "INSERT OR REPLACE INTO passkey_challenges (id, challenge, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
      )
      .bind(`chal:setup:${tmp}`, options.challenge, email, expiresAt)
      .run();

    return { tmp, options };
  }

  /** 校验初始化 / 注册 Passkey 的客户端生物识别凭据响应。 */
  async verifySetupResponse(
    db: D1Database,
    tmp: string,
    response: RegistrationResponseJSON,
    pkName = "Master Passkey",
    reqHost?: string,
    reqOrigin?: string,
  ): Promise<{ credentialId: string; publicKey: Uint8Array; counter: number; name: string }> {
    const chalKey = `chal:setup:${tmp}`;
    const row = await db
      .prepare("SELECT challenge, expires_at FROM passkey_challenges WHERE id = ?")
      .bind(chalKey)
      .first<{ challenge: string; expires_at: string }>();

    if (!row || new Date(row.expires_at).getTime() < Date.now()) {
      throw new Error("passkey_challenge_expired");
    }
    await db.prepare("DELETE FROM passkey_challenges WHERE id = ?").bind(chalKey).run();

    const expectedOrigins = resolveExpectedOrigins(this.config.origin, reqOrigin);
    const expectedRPIDs = resolveExpectedRPIDs(this.config.rpID, reqHost);
    const normalizedResponse: RegistrationResponseJSON = {
      ...response,
      response: {
        ...response.response,
        attestationObject: normalizeAttestationObject(response.response.attestationObject),
      },
    };

    const verification = await verifyRegistrationResponse({
      response: normalizedResponse,
      expectedChallenge: row.challenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: expectedRPIDs,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new Error("passkey_verification_failed");
    }

    const info = verification.registrationInfo;
    const publicKey = new Uint8Array(info.credential.publicKey as unknown as ArrayBuffer);
    return {
      credentialId: info.credential.id,
      publicKey,
      counter: info.credential.counter,
      name: pkName.trim() || "Passkey",
    };
  }

  /** 生成登录验证 Options。 */
  async generateLoginOptions(
    db: D1Database,
    reqHost?: string,
  ): Promise<{ tmp: string; options: unknown }> {
    const effectiveRpID = resolveRpID(this.config.rpID, reqHost);
    const options = await generateAuthenticationOptions({
      rpID: effectiveRpID,
      userVerification: "preferred",
    });

    const tmp = randomToken(16);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await db
      .prepare(
        "INSERT OR REPLACE INTO passkey_challenges (id, challenge, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
      )
      .bind(`chal:login:${tmp}`, options.challenge, "", expiresAt)
      .run();

    return { tmp, options };
  }

  /** 校验登录 Passkey 签名。 */
  async verifyLoginResponse(
    db: D1Database,
    tmp: string,
    response: AuthenticationResponseJSON,
    reqHost?: string,
    reqOrigin?: string,
  ): Promise<{ userId: string; credentialId: string }> {
    const chalKey = `chal:login:${tmp}`;
    const row = await db
      .prepare("SELECT challenge, expires_at FROM passkey_challenges WHERE id = ?")
      .bind(chalKey)
      .first<{ challenge: string; expires_at: string }>();

    if (!row || new Date(row.expires_at).getTime() < Date.now()) {
      throw new Error("passkey_challenge_expired");
    }
    await db.prepare("DELETE FROM passkey_challenges WHERE id = ?").bind(chalKey).run();

    const credRow = await db
      .prepare(
        "SELECT id, user_id, credential_id, public_key, counter, transports FROM passkey_credentials WHERE credential_id = ?",
      )
      .bind(response.id)
      .first<{
        id: string;
        user_id: string;
        credential_id: string;
        public_key: unknown;
        counter: number;
        transports: string | null;
      }>();

    if (!credRow) {
      throw new Error("passkey_not_found");
    }

    let pubKeyBytes: Uint8Array;
    if (credRow.public_key instanceof Uint8Array) {
      pubKeyBytes = credRow.public_key;
    } else if (typeof credRow.public_key === "string") {
      pubKeyBytes = fromB64url(credRow.public_key);
    } else if (Array.isArray(credRow.public_key)) {
      pubKeyBytes = new Uint8Array(credRow.public_key);
    } else {
      pubKeyBytes = new Uint8Array(credRow.public_key as ArrayBuffer);
    }

    const expectedOrigins = resolveExpectedOrigins(this.config.origin, reqOrigin);
    const expectedRPIDs = resolveExpectedRPIDs(this.config.rpID, reqHost);

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: row.challenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: expectedRPIDs,
      credential: {
        id: credRow.credential_id,
        publicKey: pubKeyBytes,
        counter: credRow.counter,
        transports: safeParseTransports(credRow.transports),
      },
    });

    if (!verification.verified) {
      throw new Error("passkey_authentication_failed");
    }

    // 更新 counter 和 last_used_at
    await db
      .prepare(
        "UPDATE passkey_credentials SET counter = ?, last_used_at = datetime('now') WHERE credential_id = ?",
      )
      .bind(verification.authenticationInfo.newCounter, credRow.credential_id)
      .run();

    return {
      userId: credRow.user_id,
      credentialId: credRow.credential_id,
    };
  }
}
