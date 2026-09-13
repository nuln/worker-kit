import { describe, it, expect, vi } from "vitest";
import { PasskeyService } from "../src/auth/index.js";
import {
  ConsoleEmailProvider,
  ResendEmailProvider,
  HttpEmailProvider,
  createEmailProvider,
  toRecipients,
  getDefaultFromEmail,
} from "../src/email/index.js";
import {
  queryPublicDns,
  lookupZone,
  getRoutingDNS,
  getDnsSetupInstructions,
  verifyDnsViaDoH,
} from "../src/dns/index.js";
import { AuthSessionDO } from "../src/session/do.js";
import { RateLimitService } from "../src/ratelimit/index.js";
import { OidcClient } from "../src/sso/client.js";
import {
  renderSetupHtml,
  renderLoginHtml,
  renderActionGroupHtml,
  clientThemeAndLangScript,
  renderSettingsModalHtml,
  detectLanguage,
  handleLangParam,
  clientI18nScript,
  clientThemeScript,
} from "../src/ui/index.js";
import {
  resolveExpectedRPIDs,
  resolveExpectedOrigins,
  safeParseTransports,
  normalizeAttestationObject,
} from "../src/webauthn/index.js";

// Mock D1 Database generator
function createMockD1() {
  const store = new Map<string, any[]>();
  return {
    _store: store,
    prepare: (sql: string) => {
      let params: any[] = [];
      const stmt = {
        bind: (...args: any[]) => {
          params = args;
          return stmt;
        },
        first: async <T = any>() => {
          if (sql.includes("SELECT count(*)")) {
            const list = store.get("passkey_credentials") || [];
            return { cnt: list.length } as T;
          }
          if (sql.includes("FROM passkey_challenges WHERE id = ?")) {
            const list = store.get("passkey_challenges") || [];
            const chal = list.find((c) => c.id === params[0]);
            return chal as T;
          }
          if (sql.includes("FROM passkey_credentials WHERE credential_id = ?")) {
            const list = store.get("passkey_credentials") || [];
            const cred = list.find((c) => c.credential_id === params[0]);
            return cred as T;
          }
          return null as T;
        },
        all: async <T = any>() => {
          return { results: [] as T[] };
        },
        run: async () => {
          if (sql.includes("INSERT OR REPLACE INTO passkey_challenges")) {
            const list = store.get("passkey_challenges") || [];
            const idx = list.findIndex((c) => c.id === params[0]);
            const item = { id: params[0], challenge: params[1], user_id: params[2], expires_at: params[3] };
            if (idx >= 0) list[idx] = item;
            else list.push(item);
            store.set("passkey_challenges", list);
          }
          if (sql.includes("DELETE FROM passkey_challenges WHERE id = ?")) {
            const list = store.get("passkey_challenges") || [];
            store.set("passkey_challenges", list.filter((c) => c.id !== params[0]));
          }
          if (sql.includes("UPDATE passkey_credentials SET counter =")) {
            const list = store.get("passkey_credentials") || [];
            const item = list.find((c) => c.credential_id === params[1]);
            if (item) item.counter = params[0];
          }
          return { success: true };
        },
      };
      return stmt;
    },
    batch: async (stmts: any[]) => {
      return stmts.map(() => ({ success: true }));
    },
  } as unknown as D1Database;
}

describe("PasskeyService Deep Branch Coverage", () => {
  const svc = new PasskeyService({
    rpName: "Test App",
    rpID: "test.local",
    origin: "https://test.local",
  });

  it("isInitialized returns true when credentials exist and false on empty or db error", async () => {
    const db = createMockD1();
    expect(await svc.isInitialized(db)).toBe(false);
    (db as any)._store.set("passkey_credentials", [{ id: "1" }]);
    expect(await svc.isInitialized(db)).toBe(true);

    const badDb = {
      prepare: () => {
        throw new Error("DB fail");
      },
    } as unknown as D1Database;
    expect(await svc.isInitialized(badDb)).toBe(false);
  });

  it("generateSetupOptions and verifySetupResponse expired/not found checks", async () => {
    const db = createMockD1();
    const { tmp, options } = await svc.generateSetupOptions(db, "admin@test.local", "test.local");
    expect(tmp).toBeTruthy();
    expect(options).toBeTruthy();

    await expect(
      svc.verifySetupResponse(
        db,
        "non_existent_tmp",
        {
          id: "cred1",
          rawId: "cred1",
          type: "public-key",
          response: {
            clientDataJSON: "{}",
            attestationObject: "{}",
          },
          clientExtensionResults: {},
        } as any,
      ),
    ).rejects.toThrow("passkey_challenge_expired");
  });

  it("generateLoginOptions and verifyLoginResponse expired / not found checks", async () => {
    const db = createMockD1();
    const { tmp, options } = await svc.generateLoginOptions(db, "test.local");
    expect(tmp).toBeTruthy();
    expect(options).toBeTruthy();

    await expect(
      svc.verifyLoginResponse(
        db,
        "non_existent_login_tmp",
        {
          id: "cred1",
          rawId: "cred1",
          type: "public-key",
          response: {
            clientDataJSON: "{}",
            authenticatorData: "{}",
            signature: "{}",
          },
          clientExtensionResults: {},
        } as any,
      ),
    ).rejects.toThrow("passkey_challenge_expired");
  });

  it("verifyLoginResponse handles challenge expiration", async () => {
    const db = createMockD1();
    const chalKey = "chal:login:expired_tmp";
    const past = new Date(Date.now() - 60000).toISOString();
    (db as any)._store.set("passkey_challenges", [
      { id: chalKey, challenge: "dummy_challenge", user_id: "", expires_at: past },
    ]);

    await expect(
      svc.verifyLoginResponse(
        db,
        "expired_tmp",
        {
          id: "any_cred",
          rawId: "any_cred",
          type: "public-key",
          response: {
            clientDataJSON: "{}",
            authenticatorData: "{}",
            signature: "{}",
          },
          clientExtensionResults: {},
        } as any,
      ),
    ).rejects.toThrow("passkey_challenge_expired");
  });
});

describe("WebAuthn Helper Functions Coverage", () => {
  it("resolveExpectedRPIDs handles string, array, and request host", () => {
    expect(resolveExpectedRPIDs("example.com", "sub.example.com")).toEqual(["example.com", "sub.example.com"]);
    expect(resolveExpectedRPIDs(["a.com", "b.com"], "c.com")).toEqual(["a.com", "b.com", "c.com"]);
    expect(resolveExpectedRPIDs(undefined, "d.com")).toEqual(["d.com"]);
  });

  it("resolveExpectedOrigins handles string, array, and request origin", () => {
    expect(resolveExpectedOrigins("https://a.com", "https://b.com")).toContain("https://a.com");
    expect(resolveExpectedOrigins(["https://a.com"], "https://b.com")).toContain("https://a.com");
    expect(resolveExpectedOrigins(undefined, "https://c.com")).toEqual(["https://c.com"]);
  });

  it("safeParseTransports handles null, json string, array", () => {
    expect(safeParseTransports(null)).toBeUndefined();
    expect(safeParseTransports('["internal", "hybrid"]')).toEqual(["internal", "hybrid"]);
    expect(safeParseTransports("invalid json")).toBeUndefined();
  });

  it("normalizeAttestationObject handles Uint8Array and Base64url strings", () => {
    const raw = new Uint8Array([1, 2, 3]);
    expect(normalizeAttestationObject(raw)).toBe(raw);
    const b64 = "AQID";
    expect(normalizeAttestationObject(b64)).toBe(b64);
  });
});

describe("DNS Diagnostic Suite Deep Coverage", () => {
  it("queryPublicDns handles successful and failing DoH providers", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("cloudflare-dns.com")) {
        return new Response(JSON.stringify({ Answer: [{ name: "test.com", type: 1, TTL: 300, data: "1.1.1.1" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("error", { status: 500 });
    });

    const answers = await queryPublicDns("test.com", "A");
    expect(answers.length).toBe(1);
    expect(answers[0].data).toBe("1.1.1.1");

    globalThis.fetch = origFetch;
  });

  it("lookupZone handles mock and real CF API calls", async () => {
    const mockRes = await lookupZone("", "example.com", true);
    expect(mockRes.id).toBe("mock_zone_id");

    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, result: [{ id: "zone_123", name: "example.com", status: "active" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const realRes = await lookupZone("cf_token_123", "example.com");
    expect(realRes.id).toBe("zone_123");

    // Failure case
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, result: [] }), { status: 200 }),
    );
    await expect(lookupZone("cf_token_123", "unknown.com")).rejects.toThrow("not found in Cloudflare");

    globalThis.fetch = origFetch;
  });

  it("getRoutingDNS queries Cloudflare Email Routing API", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, result: [{ type: "MX", value: "mx.cloudflare.net" }] }), {
        status: 200,
      }),
    );

    const res = await getRoutingDNS("token", "zone_1");
    expect(res).toEqual([{ type: "MX", value: "mx.cloudflare.net" }]);

    globalThis.fetch = origFetch;
  });

  it("getDnsSetupInstructions and verifyDnsViaDoH with actual DoH responses", async () => {
    const text = getDnsSetupInstructions("my-mail.org");
    expect(text).toContain("mx.cloudflare.net");

    const localRes = await verifyDnsViaDoH("test.local");
    expect(localRes.configured).toBe(true);

    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("type=MX")) {
        return new Response(JSON.stringify({ Answer: [{ data: "10 mx.cloudflare.net." }] }), { status: 200 });
      }
      if (url.includes("type=TXT")) {
        return new Response(JSON.stringify({ Answer: [{ data: '"v=spf1 include:_spf.mx.cloudflare.net ~all"' }] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    const liveRes = await verifyDnsViaDoH("my-mail.org");
    expect(liveRes.configured).toBe(true);
    expect(liveRes.method).toBe("doh");

    globalThis.fetch = origFetch;
  });
});

describe("AuthSessionDO Coverage", () => {
  it("handles in-memory session get, set, delete, and expiration", async () => {
    const doInstance = new AuthSessionDO({}, {});
    await doInstance.set("key_1", "val_1", 3600);
    expect(await doInstance.get("key_1")).toBe("val_1");

    await doInstance.delete("key_1");
    expect(await doInstance.get("key_1")).toBeNull();

    // Expired item
    await doInstance.set("key_exp", "val_exp", -10);
    expect(await doInstance.get("key_exp")).toBeNull();
  });
});

describe("Email Provider and Helper Coverage", () => {
  it("toRecipients parses various email formats", () => {
    expect(toRecipients("alice@a.com, Bob <bob@b.com>")).toEqual(["alice@a.com", "Bob <bob@b.com>"]);
    expect(toRecipients(["c@c.com", "d@d.com"])).toEqual(["c@c.com", "d@d.com"]);
    expect(toRecipients(null)).toEqual([]);
  });

  it("getDefaultFromEmail derives default sender", () => {
    expect(getDefaultFromEmail({}, "example.com")).toBe("noreply@example.com");
    expect(getDefaultFromEmail({ DOMAINS: "mail.test" })).toBe("noreply@mail.test");
  });

  it("ConsoleEmailProvider, ResendEmailProvider, and HttpEmailProvider operate correctly", async () => {
    const consoleP = new ConsoleEmailProvider();
    await expect(consoleP.send({ to: "test@test.com", subject: "Hi", text: "Test" })).resolves.not.toThrow();

    const resendMockP = new ResendEmailProvider("mock_key", "no-reply@test.com");
    await expect(resendMockP.send({ to: "test@test.com", subject: "Hi", text: "Test" })).resolves.not.toThrow();

    const httpMockP = new HttpEmailProvider("http://mock.local/inbound", "no-reply@test.com", "mock_key");
    await expect(httpMockP.send({ to: "test@test.com", subject: "Hi", text: "Test" })).resolves.not.toThrow();

    const factoryP = createEmailProvider({ EMAIL_PROVIDER: "console" });
    await expect(factoryP.send({ to: "a@a.com", subject: "Hi", text: "Hello" })).resolves.not.toThrow();
  });
});

describe("UI Components and I18n Coverage", () => {
  it("detectLanguage and handleLangParam detect and set language cookies", () => {
    const req1 = new Request("https://example.com/?lang=en");
    expect(detectLanguage(req1)).toBe("en");

    const req2 = new Request("https://example.com/", { headers: { cookie: "lang=zh" } });
    expect(detectLanguage(req2)).toBe("zh");

    const req3 = new Request("https://example.com/", { headers: { "accept-language": "zh-CN,zh;q=0.9" } });
    expect(detectLanguage(req3)).toBe("zh");

    const langRes = handleLangParam(req1);
    expect(langRes).not.toBeNull();
    expect(langRes!.headers.get("Set-Cookie")).toContain("lang=en");
  });

  it("client scripts return valid script templates", () => {
    expect(clientI18nScript()).toContain("toggleLanguage");
    expect(clientThemeScript()).toContain("toggleTheme");
    expect(clientThemeAndLangScript("zh")).toContain("toggleTheme");
  });

  it("renders action group, settings modal, and auth pages correctly", () => {
    const actionHtml = renderActionGroupHtml({
      lang: "zh",
      showLang: true,
      showTheme: true,
      showNotifications: true,
      notificationsCount: 5,
      user: { name: "Admin", email: "admin@test.local", role: "SuperAdmin" },
    });
    expect(actionHtml).toContain("Admin");
    expect(actionHtml).toContain("SuperAdmin");
    expect(actionHtml).toContain("badge-dot");

    const modal = renderSettingsModalHtml({
      serviceName: "Tower",
      version: "2.0.0",
      tabsContent: {
        generalHtml: "<div>Custom General Settings</div>",
      },
    });
    expect(modal).toContain("Custom General Settings");
    expect(modal).toContain("Tower");
    expect(modal).toContain("v2.0.0");

    const setupHtml = renderSetupHtml({
      serviceName: "Nuln Portal",
      basePath: "/portal",
      defaultEmail: "root@local",
    });
    expect(setupHtml).toContain("Nuln Portal");
    expect(setupHtml).toContain("/portal");

    const loginHtml = renderLoginHtml({
      serviceName: "Nuln Portal",
      basePath: "/portal",
      oidcEnabled: true,
    });
    expect(loginHtml).toContain("Nuln Portal");
    expect(loginHtml).toContain("/portal/oidc/login");
  });
});
