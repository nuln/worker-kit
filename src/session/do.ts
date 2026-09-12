/**
 * @nuln/worker-kit/session/do
 *
 * 边缘 Durable Object 内存临时会话与状态机
 * 适用于：临时登录态、Challenge、OAuth Authorization Code、单次消费 Token (CAS)
 */

let BaseDurableObject: any = class {};
try {
  const cf = await import("cloudflare:workers");
  if (cf?.DurableObject) {
    BaseDurableObject = cf.DurableObject;
  }
} catch {
  // Node / non-workerd fallback
}

/**
 * Cloudflare Durable Object for ephemeral in-memory Auth Sessions, WebAuthn Challenges,
 * OAuth2 Authorization Codes, and Magic Link tokens.
 * Guarantees Strictly-Once consumption in memory and eliminates D1 disk writes/fragmentation.
 */
export class AuthSessionDO extends (BaseDurableObject as any) {
  private store = new Map<string, { value: string; expiresAt: number }>();
  ctx: any;
  env: any;

  constructor(ctx: any, env: any) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    const expiresAt = Date.now() + ttlSec * 1000;
    this.store.set(key, { value, expiresAt });
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  /**
   * Atomically fetch and immediately remove key (Strictly-Once CAS).
   */
  async take(key: string): Promise<string | null> {
    const val = await this.get(key);
    if (val !== null) {
      this.store.delete(key);
    }
    return val;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async alarm() {
    const now = Date.now();
    for (const [k, v] of this.store.entries()) {
      if (now > v.expiresAt) {
        this.store.delete(k);
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/set" && request.method === "POST") {
      const b = (await request.json().catch(() => ({}))) as any;
      await this.set(String(b?.key), String(b?.value), Number(b?.ttlSec || 300));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname === "/get") {
      const key = url.searchParams.get("key") || "";
      const val = await this.get(key);
      return new Response(JSON.stringify({ value: val }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname === "/take" && request.method === "POST") {
      const b = (await request.json().catch(() => ({}))) as any;
      const val = await this.take(String(b?.key));
      return new Response(JSON.stringify({ value: val }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname === "/delete" && request.method === "POST") {
      const b = (await request.json().catch(() => ({}))) as any;
      await this.delete(String(b?.key));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Not Found", { status: 404 });
  }
}
