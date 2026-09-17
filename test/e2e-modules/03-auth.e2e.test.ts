import { describe, it, expect, vi } from "vitest";
import { PasskeyService } from "../../src/auth/index.js";
import * as webauthnModule from "../../src/webauthn/index.js";

describe("[E2E Example] 03 - Full User Setup, Login & Passkey Management", () => {
  it("executes first-access admin setup, login verification, and credential renaming", async () => {
    const credentials: any[] = [];
    const challenges: any[] = [];

    const mockDb = {
      prepare(sql: string) {
        return {
          bind(...params: any[]) {
            return {
              async first<T = any>(): Promise<T | null> {
                if (sql.includes("count(*) as cnt FROM passkey_credentials")) {
                  return { cnt: credentials.length } as any;
                }
                if (sql.includes("FROM passkey_challenges WHERE id = ?")) {
                  const row = challenges.find((c) => c.id === params[0]);
                  return (row as any) || null;
                }
                if (sql.includes("FROM passkey_credentials WHERE credential_id = ?")) {
                  const row = credentials.find((c) => c.credential_id === params[0]);
                  return (row as any) || null;
                }
                return null;
              },
              async all<T = any>() {
                return { results: credentials.filter((c) => c.user_id === params[0]) };
              },
              async run() {
                if (sql.startsWith("INSERT OR REPLACE INTO passkey_challenges")) {
                  challenges.push({ id: params[0], challenge: params[1], expires_at: params[3] });
                }
                if (sql.startsWith("DELETE FROM passkey_challenges")) {
                  const idx = challenges.findIndex((c) => c.id === params[0]);
                  if (idx >= 0) challenges.splice(idx, 1);
                }
                if (sql.startsWith("INSERT INTO passkey_credentials")) {
                  credentials.push({
                    id: params[0],
                    user_id: params[1],
                    credential_id: params[2],
                    public_key: params[3],
                    counter: params[4],
                    name: params[6],
                  });
                }
                if (sql.startsWith("UPDATE passkey_credentials SET counter")) {
                  const row = credentials.find((c) => c.credential_id === params[1]);
                  if (row) row.counter = params[0];
                }
                if (sql.startsWith("UPDATE passkey_credentials SET name")) {
                  const row = credentials.find((c) => c.id === params[1] && c.user_id === params[2]);
                  if (row) row.name = params[0];
                }
                return { meta: { changes: 1 } };
              },
            };
          },
          async first<T = any>() {
            if (sql.includes("count(*) as cnt FROM passkey_credentials")) {
              return { cnt: credentials.length } as any;
            }
            return null;
          },
        };
      },
    };

    const auth = new PasskeyService({
      rpName: "Nuln Cloud",
      rpID: "cloud.nuln.net",
      origin: "https://cloud.nuln.net",
    });

    // 1. Initial State: Uninitialized
    expect(await auth.isInitialized(mockDb as any)).toBe(false);

    // 2. Step 1: Admin Setup Registration
    const setupOpts = await auth.generateSetupOptions(mockDb as any, "admin@nuln.net");
    expect(setupOpts.tmp).toBeDefined();

    vi.spyOn(webauthnModule, "verifyRegistrationResponse").mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        credential: { id: "cred_super_admin", publicKey: new Uint8Array([1, 2, 3, 4]), counter: 0 },
        aaguid: "00000000-0000-0000-0000-000000000000",
      } as any,
    });

    const setupVerify = await auth.verifySetupResponse(
      mockDb as any,
      setupOpts.tmp,
      { id: "cred_super_admin", response: { attestationObject: "att" } } as any,
      "SuperAdmin YubiKey"
    );
    expect(setupVerify.credentialId).toBe("cred_super_admin");

    // Save credential to DB
    credentials.push({
      id: "pk_01",
      user_id: "admin@nuln.net",
      credential_id: "cred_super_admin",
      public_key: setupVerify.publicKey,
      counter: 0,
      name: setupVerify.name,
      transports: null,
      aaguid: null,
    });

    expect(await auth.isInitialized(mockDb as any)).toBe(true);

    // 3. Step 2: Login Flow
    const loginOpts = await auth.generateLoginOptions(mockDb as any);
    expect(loginOpts.tmp).toBeDefined();

    vi.spyOn(webauthnModule, "verifyAuthenticationResponse").mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 1 } as any,
    });

    const loginRes = await auth.verifyLoginResponse(
      mockDb as any,
      loginOpts.tmp,
      { id: "cred_super_admin", response: {} } as any
    );
    expect(loginRes.userId).toBe("admin@nuln.net");
    expect(credentials[0].counter).toBe(1);

    // 4. Step 3: Manage Passkeys (Rename)
    const passkeys = await auth.listPasskeys(mockDb as any, "admin@nuln.net");
    expect(passkeys.length).toBe(1);
    expect(passkeys[0].name).toBe("SuperAdmin YubiKey");

    const renamed = await auth.renamePasskey(mockDb as any, "admin@nuln.net", "pk_01", "Primary Backup Key");
    expect(renamed).toBe(true);
  });
});
