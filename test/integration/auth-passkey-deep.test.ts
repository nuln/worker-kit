import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PasskeyService,
  formatPasskeyErrorMessage,
  buildPasskeyUserId,
  parsePasskeyUserHandle,
} from "../../src/auth/passkey.js";
import * as webauthnModule from "../../src/webauthn/index.js";

function createMockDb() {
  const store: Record<string, any[]> = {
    passkey_credentials: [],
    passkey_challenges: [],
  };

  return {
    _store: store,
    prepare(sql: string) {
      return {
        bind(...params: any[]) {
          return {
            async first<T = any>(): Promise<T | null> {
              if (sql.includes("count(*) as cnt FROM passkey_credentials")) {
                return { cnt: store.passkey_credentials.length } as any;
              }
              if (sql.includes("FROM passkey_challenges WHERE id = ?")) {
                const id = params[0];
                const row = store.passkey_challenges.find((c) => c.id === id);
                return (row as any) || null;
              }
              if (sql.includes("FROM passkey_credentials WHERE credential_id = ?")) {
                const credId = params[0];
                const row = store.passkey_credentials.find((c) => c.credential_id === credId);
                return (row as any) || null;
              }
              return null;
            },
            async all<T = any>() {
              if (sql.includes("SELECT credential_id FROM passkey_credentials WHERE user_id = ?")) {
                const userId = params[0];
                const results = store.passkey_credentials.filter((c) => c.user_id === userId);
                return { results };
              }
              if (sql.includes("FROM passkey_credentials WHERE user_id = ?")) {
                const userId = params[0];
                const results = store.passkey_credentials.filter((c) => c.user_id === userId);
                return { results };
              }
              return { results: [] };
            },
            async run() {
              if (sql.startsWith("INSERT OR REPLACE INTO passkey_challenges") || sql.startsWith("INSERT INTO passkey_challenges")) {
                const [id, challenge, user_id, expires_at] = params;
                const existingIdx = store.passkey_challenges.findIndex((c) => c.id === id);
                const row = { id, challenge, user_id, expires_at };
                if (existingIdx >= 0) store.passkey_challenges[existingIdx] = row;
                else store.passkey_challenges.push(row);
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("DELETE FROM passkey_challenges WHERE id = ?")) {
                const id = params[0];
                store.passkey_challenges = store.passkey_challenges.filter((c) => c.id !== id);
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("INSERT INTO passkey_credentials")) {
                const [id, user_id, credential_id, public_key, counter, transports, name, aaguid] = params;
                store.passkey_credentials.push({
                  id,
                  user_id,
                  credential_id,
                  public_key,
                  counter,
                  transports,
                  name,
                  aaguid,
                  created_at: new Date().toISOString(),
                });
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("UPDATE passkey_credentials SET counter = ?")) {
                const [counter, credential_id] = params;
                const row = store.passkey_credentials.find((c) => c.credential_id === credential_id);
                if (row) {
                  row.counter = counter;
                  row.last_used_at = new Date().toISOString();
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (sql.startsWith("UPDATE passkey_credentials SET name = ?")) {
                const [name, id, user_id] = params;
                const row = store.passkey_credentials.find((c) => c.id === id && c.user_id === user_id);
                if (row) {
                  row.name = name;
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (sql.startsWith("DELETE FROM passkey_credentials WHERE id = ? AND user_id = ?")) {
                const [id, user_id] = params;
                const prevLen = store.passkey_credentials.length;
                store.passkey_credentials = store.passkey_credentials.filter(
                  (c) => !(c.id === id && c.user_id === user_id)
                );
                return { meta: { changes: store.passkey_credentials.length < prevLen ? 1 : 0 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
        async first<T = any>() {
          if (sql.includes("count(*) as cnt FROM passkey_credentials")) {
            return { cnt: store.passkey_credentials.length } as any;
          }
          return null;
        },
      };
    },
  } as unknown as D1Database;
}

describe("@nuln/worker-kit/auth/passkey - Error Formatter", () => {
  it("formats standard passkey errors correctly", () => {
    expect(formatPasskeyErrorMessage(null)).toBe("通行密钥验证失败");
    expect(formatPasskeyErrorMessage("")).toBe("通行密钥验证失败");
    expect(formatPasskeyErrorMessage(new Error("timed out"))).toContain("通行密钥验证已取消或超时");
    expect(formatPasskeyErrorMessage({ name: "NotAllowedError" })).toContain("通行密钥验证已取消或超时");
    expect(formatPasskeyErrorMessage("The operation either timed out or was not allowed")).toContain("通行密钥验证已取消或超时");
    expect(formatPasskeyErrorMessage("AbortError")).toContain("通行密钥验证已取消或超时");
    expect(formatPasskeyErrorMessage("passkey_challenge_expired")).toContain("通行密钥验证已过期");
    expect(formatPasskeyErrorMessage("passkey_not_found")).toContain("未找到匹配的通行密钥");
    expect(formatPasskeyErrorMessage("passkey_authentication_failed")).toContain("通行密钥身份验证失败");
    expect(formatPasskeyErrorMessage("passkey_user_mismatch")).toContain("通行密钥用户不匹配");
    expect(formatPasskeyErrorMessage("last_passkey")).toContain("至少需要保留一个 Passkey");
    expect(formatPasskeyErrorMessage("Custom database error")).toBe("Custom database error");
  });

  it("buildPasskeyUserId produces deterministic namespaced byte array", () => {
    const b1 = buildPasskeyUserId("tower", "admin@nuln.net");
    const b2 = buildPasskeyUserId("tower", "ADMIN@nuln.net ");
    const bOidc = buildPasskeyUserId("oidc", "admin@nuln.net");
    const bMail = buildPasskeyUserId("mail", "admin@nuln.net");

    // Deterministic: multiple invocations yield exact same bytes
    expect(Array.from(b1)).toEqual(Array.from(b2));
    expect(new TextDecoder().decode(b1)).toBe("tower\x1fadmin@nuln.net");

    // Mutually distinct across different service IDs
    expect(new TextDecoder().decode(bOidc)).toBe("oidc\x1fadmin@nuln.net");
    expect(new TextDecoder().decode(bMail)).toBe("mail\x1fadmin@nuln.net");
    expect(Array.from(b1)).not.toEqual(Array.from(bOidc));
    expect(Array.from(b1)).not.toEqual(Array.from(bMail));
    expect(Array.from(bOidc)).not.toEqual(Array.from(bMail));
  });

  it("parsePasskeyUserHandle parses namespaced and legacy user handles", () => {
    expect(parsePasskeyUserHandle(null)).toBeNull();
    expect(parsePasskeyUserHandle(undefined)).toBeNull();

    // Namespaced string
    const parsed1 = parsePasskeyUserHandle("tower\x1fadmin@nuln.net");
    expect(parsed1).toEqual({ serviceId: "tower", email: "admin@nuln.net" });

    // Namespaced Uint8Array
    const bytes = new TextEncoder().encode("oidc\x1fuser@example.com");
    const parsed2 = parsePasskeyUserHandle(bytes);
    expect(parsed2).toEqual({ serviceId: "oidc", email: "user@example.com" });

    // Namespaced ArrayBuffer
    const ab = bytes.buffer;
    const parsed3 = parsePasskeyUserHandle(ab);
    expect(parsed3).toEqual({ serviceId: "oidc", email: "user@example.com" });

    // Base64url encoded namespaced
    const b64urlNamespaced = Buffer.from("push\x1fadmin@nuln.net").toString("base64url");
    const parsedB64 = parsePasskeyUserHandle(b64urlNamespaced);
    expect(parsedB64).toEqual({ serviceId: "push", email: "admin@nuln.net" });

    // Base64url encoded legacy bare email
    const b64urlLegacy = Buffer.from("legacy@nuln.net").toString("base64url");
    const parsedB64Legacy = parsePasskeyUserHandle(b64urlLegacy);
    expect(parsedB64Legacy).toEqual({ email: "legacy@nuln.net" });

    // Legacy bare email
    const legacy = parsePasskeyUserHandle("admin@nuln.net");
    expect(legacy).toEqual({ email: "admin@nuln.net" });

    // Empty string
    expect(parsePasskeyUserHandle("")).toBeNull();
  });
});

describe("@nuln/worker-kit/auth/passkey - PasskeyService Lifecycle & Branches", () => {
  const config = {
    rpName: "Nuln Auth",
    rpID: "auth.nuln.net",
    origin: "https://auth.nuln.net",
  };

  it("isInitialized returns false when no credentials exist or db errors", async () => {
    const db = createMockDb();
    const service = new PasskeyService(config);

    expect(await service.isInitialized(db)).toBe(false);

    (db as any)._store.passkey_credentials.push({ id: "pk1" });
    expect(await service.isInitialized(db)).toBe(true);

    const errorDb = {
      prepare() {
        throw new Error("DB fatal");
      },
    } as any;
    expect(await service.isInitialized(errorDb)).toBe(false);
  });

  it("generateSetupOptions and verifySetupResponse lifecycle", async () => {
    const db = createMockDb();
    const service = new PasskeyService(config);

    const { tmp, options } = await service.generateSetupOptions(db, "admin@nuln.net", "auth.nuln.net", "oidc");
    expect(tmp).toBeDefined();
    expect((options as any).challenge).toBeDefined();
    expect((options as any).user.name).toBe("admin@nuln.net");

    // Mock verifyRegistrationResponse
    vi.spyOn(webauthnModule, "verifyRegistrationResponse").mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        credential: {
          id: "cred-admin-01",
          publicKey: new Uint8Array([1, 2, 3, 4, 5]),
          counter: 0,
        },
        aaguid: "00000000-0000-0000-0000-000000000000",
      } as any,
    });

    const mockResponse: any = {
      id: "cred-admin-01",
      rawId: "cred-admin-01",
      type: "public-key",
      response: {
        clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0",
        attestationObject: "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVjU",
      },
    };

    const res = await service.verifySetupResponse(
      db,
      tmp,
      mockResponse,
      "YubiKey Admin",
      "auth.nuln.net",
      "https://auth.nuln.net"
    );

    expect(res.credentialId).toBe("cred-admin-01");
    expect(res.name).toBe("YubiKey Admin");
    expect(res.publicKey).toBeInstanceOf(Uint8Array);
  });

  it("verifySetupResponse throws if challenge expired or missing", async () => {
    const db = createMockDb();
    const service = new PasskeyService(config);

    await expect(
      service.verifySetupResponse(db, "nonexistent-tmp", {} as any)
    ).rejects.toThrow("passkey_challenge_expired");
  });

  it("verifySetupResponse throws if verification fails", async () => {
    const db = createMockDb();
    const service = new PasskeyService(config);

    const { tmp } = await service.generateSetupOptions(db, "admin@nuln.net", undefined, "oidc");

    vi.spyOn(webauthnModule, "verifyRegistrationResponse").mockResolvedValueOnce({
      verified: false,
    } as any);

    const mockResponse: any = {
      id: "cred-01",
      response: { attestationObject: "att" },
    };

    await expect(service.verifySetupResponse(db, tmp, mockResponse)).rejects.toThrow(
      "passkey_verification_failed"
    );
  });

  it("generateLoginOptions and verifyLoginResponse lifecycle with counter updates", async () => {
    const db = createMockDb();
    const service = new PasskeyService(config);

    // Seed credential in DB
    (db as any)._store.passkey_credentials.push({
      id: "pk_01",
      user_id: "user_123",
      credential_id: "cred_login_123",
      public_key: "AQIDBAU", // base64url string
      counter: 10,
      transports: '["internal"]',
      name: "Touch ID",
      aaguid: null,
    });

    const { tmp } = await service.generateLoginOptions(db, "auth.nuln.net");

    vi.spyOn(webauthnModule, "verifyAuthenticationResponse").mockResolvedValueOnce({
      verified: true,
      authenticationInfo: {
        newCounter: 11,
      } as any,
    });

    const mockAuthResponse: any = {
      id: "cred_login_123",
      rawId: "cred_login_123",
      type: "public-key",
      response: {
        clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0",
        authenticatorData: "authData",
        signature: "sig",
      },
    };

    const loginRes = await service.verifyLoginResponse(
      db,
      tmp,
      mockAuthResponse,
      "auth.nuln.net",
      "https://auth.nuln.net"
    );

    expect(loginRes.userId).toBe("user_123");
    expect(loginRes.credentialId).toBe("cred_login_123");

    // Check counter update in DB
    const saved = (db as any)._store.passkey_credentials.find((c: any) => c.credential_id === "cred_login_123");
    expect(saved.counter).toBe(11);
    expect(saved.last_used_at).toBeDefined();
  });

  it("verifyLoginResponse throws when passkey_not_found or unverified", async () => {
    const db = createMockDb();
    const service = new PasskeyService(config);

    const { tmp } = await service.generateLoginOptions(db);

    const mockUnknown: any = { id: "unknown_cred", response: {} };
    await expect(service.verifyLoginResponse(db, tmp, mockUnknown)).rejects.toThrow("passkey_not_found");

    // Seed credential
    (db as any)._store.passkey_credentials.push({
      id: "pk_02",
      user_id: "user_456",
      credential_id: "cred_fail",
      public_key: new Uint8Array([1, 2, 3]),
      counter: 1,
    });

    const { tmp: tmp2 } = await service.generateLoginOptions(db);
    vi.spyOn(webauthnModule, "verifyAuthenticationResponse").mockResolvedValueOnce({
      verified: false,
    } as any);

    await expect(service.verifyLoginResponse(db, tmp2, { id: "cred_fail", response: {} } as any)).rejects.toThrow(
      "passkey_authentication_failed"
    );
  });

  it("generateRegisterOptions and verifyRegisterResponse for logged-in user", async () => {
    const db = createMockDb();
    const service = new PasskeyService(config);

    // Existing cred
    (db as any)._store.passkey_credentials.push({
      id: "pk_old",
      user_id: "user_789",
      credential_id: "cred_old",
      public_key: [1, 2, 3],
      counter: 0,
    });

    const { tmp, options } = await service.generateRegisterOptions(db, "user_789", "bob@nuln.net", undefined, "oidc");
    expect((options as any).excludeCredentials?.length).toBe(1);

    vi.spyOn(webauthnModule, "verifyRegistrationResponse").mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        credential: {
          id: "cred_new_key",
          publicKey: new Uint8Array([9, 8, 7, 6]),
          counter: 0,
        },
        aaguid: "00000000-0000-0000-0000-000000000000",
      } as any,
    });

    const record = await service.verifyRegisterResponse(
      db,
      "user_789",
      tmp,
      { id: "cred_new_key", response: { attestationObject: "att" } } as any,
      "Secondary Passkey"
    );

    expect(record.userId).toBe("user_789");
    expect(record.credentialId).toBe("cred_new_key");
    expect(record.name).toBe("Secondary Passkey");
  });

  it("verifyRegisterResponse throws on user mismatch or verification failure", async () => {
    const db = createMockDb();
    const service = new PasskeyService(config);

    const { tmp } = await service.generateRegisterOptions(db, "user_real", "real@nuln.net", undefined, "oidc");

    await expect(
      service.verifyRegisterResponse(db, "user_imposter", tmp, {} as any)
    ).rejects.toThrow("passkey_user_mismatch");

    const { tmp: tmp2 } = await service.generateRegisterOptions(db, "user_real", "real@nuln.net", undefined, "oidc");
    vi.spyOn(webauthnModule, "verifyRegistrationResponse").mockResolvedValueOnce({
      verified: false,
    } as any);

    await expect(
      service.verifyRegisterResponse(db, "user_real", tmp2, { response: { attestationObject: "att" } } as any)
    ).rejects.toThrow("passkey_verification_failed");
  });

  it("verifyLoginResponse supports legacy credentials during migration", async () => {
    const db = createMockDb();
    const service = new PasskeyService(config);

    // Seed legacy credential where user_id was raw email or old format
    (db as any)._store.passkey_credentials.push({
      id: "pk_legacy",
      user_id: "legacy_user_1",
      credential_id: "cred_legacy_123",
      public_key: new Uint8Array([1, 2, 3, 4]),
      counter: 5,
    });

    const { tmp } = await service.generateLoginOptions(db);

    vi.spyOn(webauthnModule, "verifyAuthenticationResponse").mockResolvedValueOnce({
      verified: true,
      authenticationInfo: {
        newCounter: 6,
        credentialID: "cred_legacy_123",
        userHandle: "admin@nuln.net", // bare email legacy userHandle
      } as any,
    });

    const loginRes = await service.verifyLoginResponse(
      db,
      tmp,
      {
        id: "cred_legacy_123",
        rawId: "cred_legacy_123",
        type: "public-key",
        response: {
          clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0",
          authenticatorData: "authData",
          signature: "sig",
          userHandle: "admin@nuln.net",
        },
      } as any,
      "auth.nuln.net",
      "https://auth.nuln.net"
    );

    expect(loginRes.userId).toBe("legacy_user_1");
    expect(loginRes.credentialId).toBe("cred_legacy_123");

    // Also verify with namespaced userHandle
    const { tmp: tmp2 } = await service.generateLoginOptions(db);
    vi.spyOn(webauthnModule, "verifyAuthenticationResponse").mockResolvedValueOnce({
      verified: true,
      authenticationInfo: {
        newCounter: 7,
        credentialID: "cred_legacy_123",
        userHandle: Buffer.from("tower\x1fadmin@nuln.net").toString("base64url"),
      } as any,
    });

    const loginRes2 = await service.verifyLoginResponse(
      db,
      tmp2,
      {
        id: "cred_legacy_123",
        rawId: "cred_legacy_123",
        type: "public-key",
        response: {
          clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0",
          authenticatorData: "authData",
          signature: "sig",
          userHandle: Buffer.from("tower\x1fadmin@nuln.net").toString("base64url"),
        },
      } as any,
      "auth.nuln.net",
      "https://auth.nuln.net"
    );

    expect(loginRes2.userId).toBe("legacy_user_1");
    expect(loginRes2.credentialId).toBe("cred_legacy_123");
  });

  it("listPasskeys, renamePasskey, and deletePasskey management APIs", async () => {
    const db = createMockDb();
    const service = new PasskeyService(config);

    (db as any)._store.passkey_credentials.push(
      {
        id: "pk_100",
        user_id: "u_abc",
        credential_id: "c_100",
        public_key: new ArrayBuffer(4),
        counter: 5,
        transports: '["internal"]',
        name: "Old Name",
        aaguid: null,
      },
      {
        id: "pk_200",
        user_id: "u_abc",
        credential_id: "c_200",
        public_key: "AQID",
        counter: 0,
        transports: null,
        name: "Macbook Touch ID",
        aaguid: "adce0002-35bc-c60a-648b-0b25f1f05503",
      }
    );

    const list = await service.listPasskeys(db, "u_abc");
    expect(list.length).toBe(2);
    expect(list[0].brandInfo).toBeDefined();

    const renamed = await service.renamePasskey(db, "u_abc", "pk_100", "New Super Key");
    expect(renamed).toBe(true);

    const updatedList = await service.listPasskeys(db, "u_abc");
    expect(updatedList.find((p) => p.id === "pk_100")?.name).toBe("New Super Key");

    const deleted = await service.deletePasskey(db, "u_abc", "pk_100");
    expect(deleted).toBe(true);
    expect((await service.listPasskeys(db, "u_abc")).length).toBe(1);

    const deleteNonexistent = await service.deletePasskey(db, "u_abc", "pk_999");
    expect(deleteNonexistent).toBe(false);
  });
});
