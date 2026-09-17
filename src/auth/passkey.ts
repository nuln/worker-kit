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
  normalizeAaguid,
  resolveAAGUID,
  type AuthenticatorBrandInfo,
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

/**
 * 统一将 WebAuthn / Passkey 异常转换为标准友好的用户提示文案
 */
export function formatPasskeyErrorMessage(err: unknown): string {
  if (!err) return "通行密钥验证失败";
  const msg = typeof err === "string" ? err : (err as any)?.message || String(err);
  const name = (err as any)?.name || "";

  if (
    name === "NotAllowedError" ||
    msg.includes("timed out") ||
    msg.includes("not allowed") ||
    msg.includes("The operation either timed out or was not allowed") ||
    msg.includes("cancelled") ||
    msg.includes("canceled") ||
    msg.includes("AbortError")
  ) {
    return "通行密钥验证已取消或超时，请重试";
  }
  if (msg.includes("passkey_challenge_expired") || msg.includes("expired")) {
    return "通行密钥验证已过期，请重试";
  }
  if (msg.includes("passkey_not_found") || msg.includes("not found")) {
    return "未找到匹配的通行密钥";
  }
  if (
    msg.includes("passkey_authentication_failed") ||
    msg.includes("passkey_verification_failed") ||
    msg.includes("verification failed")
  ) {
    return "通行密钥身份验证失败";
  }
  if (msg.includes("passkey_user_mismatch")) {
    return "通行密钥用户不匹配";
  }
  if (msg.includes("last_passkey")) {
    return "至少需要保留一个 Passkey，无法删除";
  }
  return msg;
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
      userID: userId as any,
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
  ): Promise<{ credentialId: string; publicKey: Uint8Array; counter: number; name: string; aaguid?: string }> {
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
      aaguid: normalizeAaguid((info as any).aaguid),
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
        publicKey: pubKeyBytes as any,
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

  /** 已登录用户生成绑定新 Passkey 的 Options。 */
  async generateRegisterOptions(
    db: D1Database,
    userId: string,
    userEmail: string,
    reqHost?: string,
  ): Promise<{ tmp: string; options: unknown }> {
    const effectiveRpID = resolveRpID(this.config.rpID, reqHost);
    const uIdBytes = new TextEncoder().encode(userId);

    // 查询该用户已有的凭据以排除重复注册
    const existingCreds = await db
      .prepare("SELECT credential_id FROM passkey_credentials WHERE user_id = ?")
      .bind(userId)
      .all<{ credential_id: string }>();

    const excludeCredentials = (existingCreds?.results || []).map((c) => ({
      id: c.credential_id,
      type: "public-key" as const,
    }));

    const options = await generateRegistrationOptions({
      rpName: this.config.rpName,
      rpID: effectiveRpID,
      userName: userEmail,
      userID: uIdBytes as any,
      attestationType: "none",
      excludeCredentials,
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
      .bind(`chal:reg:${tmp}`, options.challenge, userId, expiresAt)
      .run();

    return { tmp, options };
  }

  /** 校验并落库用户新绑定的 Passkey。 */
  async verifyRegisterResponse(
    db: D1Database,
    userId: string,
    tmp: string,
    response: RegistrationResponseJSON,
    pkName = "Passkey",
    reqHost?: string,
    reqOrigin?: string,
  ): Promise<PasskeyRecord> {
    const chalKey = `chal:reg:${tmp}`;
    const row = await db
      .prepare("SELECT challenge, user_id, expires_at FROM passkey_challenges WHERE id = ?")
      .bind(chalKey)
      .first<{ challenge: string; user_id: string; expires_at: string }>();

    if (!row || new Date(row.expires_at).getTime() < Date.now()) {
      throw new Error("passkey_challenge_expired");
    }
    if (row.user_id && row.user_id !== userId) {
      throw new Error("passkey_user_mismatch");
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
    const publicKeyB64 = toB64url(new Uint8Array(info.credential.publicKey as unknown as ArrayBuffer));
    const passkeyId = `pk_${randomToken(12)}`;
    const transportsJson = JSON.stringify(response.response?.transports || ["internal"]);
    const name = pkName.trim() || "Passkey";
    const aaguid = normalizeAaguid((info as any).aaguid);

    await db
      .prepare(
        "INSERT INTO passkey_credentials (id, user_id, credential_id, public_key, counter, transports, name, aaguid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
      )
      .bind(passkeyId, userId, info.credential.id, publicKeyB64, info.credential.counter, transportsJson, name, aaguid)
      .run();

    return {
      id: passkeyId,
      userId,
      credentialId: info.credential.id,
      publicKey: publicKeyB64,
      counter: info.credential.counter,
      transports: transportsJson,
      name,
      aaguid,
    };
  }

  /** 获取指定用户的所有 Passkey 列表。 */
  async listPasskeys(db: D1Database, userId: string): Promise<Array<Omit<PasskeyRecord, "publicKey"> & { brandInfo?: AuthenticatorBrandInfo }>> {
    const res = await db
      .prepare(
        "SELECT id, user_id as userId, credential_id as credentialId, counter, transports, name, aaguid, created_at as createdAt, last_used_at as lastUsedAt FROM passkey_credentials WHERE user_id = ? ORDER BY created_at DESC",
      )
      .bind(userId)
      .all<Omit<PasskeyRecord, "publicKey">>();
    return (res.results || []).map((pk) => ({
      ...pk,
      brandInfo: resolveAAGUID(pk.aaguid),
    }));
  }

  /** 删除指定 Passkey。 */
  async deletePasskey(db: D1Database, userId: string, passkeyId: string): Promise<boolean> {
    const res = await db
      .prepare("DELETE FROM passkey_credentials WHERE id = ? AND user_id = ?")
      .bind(passkeyId, userId)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  /** 重命名指定 Passkey。 */
  async renamePasskey(db: D1Database, userId: string, passkeyId: string, newName: string): Promise<boolean> {
    const res = await db
      .prepare("UPDATE passkey_credentials SET name = ? WHERE id = ? AND user_id = ?")
      .bind(newName.trim() || "Passkey", passkeyId, userId)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }
}
