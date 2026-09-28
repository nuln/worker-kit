/**
 * @nuln/worker-kit/session/do
 *
 * 边缘 Durable Object 内存临时会话与状态机
 * 适用于：临时登录态、Challenge、OAuth Authorization Code、单次消费 Token (CAS)
 */

import { timingSafeEqual } from "../crypto/index.js";
import { assertConfigured } from "../config/index.js";

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
/** 统一 JSON 响应（AGENTS §7.1 契约）。 */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** 判定环境变量是否已注入且非空。 */
function present(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  return typeof v === "string" ? v.trim().length > 0 : true;
}

export class AuthSessionDO extends (BaseDurableObject as any) {
  private store = new Map<string, { value: string; expiresAt: number }>();
  ctx: any;
  env: any;

  constructor(ctx: any, env: any) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  /** 存储容量上限：超过后写入最旧的条目，防止内存无界增长。 */
  static readonly MAX_ENTRIES = 10_000;
  /** TTL 允许范围（秒）：下限避免立即过期，上限避免条目永久驻留。 */
  static readonly MIN_TTL_SEC = 1;
  static readonly MAX_TTL_SEC = 86_400;

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    // TTL 必须是正整数且在允许范围内：0 会被 || 兜底成 300（语义错误），
    // 负数产生立即过期的条目，超大值则让条目近乎永久驻留。
    const ttl = Number(ttlSec);
    const safeTtl = Number.isFinite(ttl)
      ? Math.min(Math.max(Math.trunc(ttl), AuthSessionDO.MIN_TTL_SEC), AuthSessionDO.MAX_TTL_SEC)
      : 300;

    const expiresAt = Date.now() + safeTtl * 1000;
    this.store.set(key, { value, expiresAt });
    this.evictIfNeeded();
    await this.scheduleSweep(expiresAt);
  }

  /**
   * 容量保护：超过 {@link MAX_ENTRIES} 时按到期时间淘汰最旧的条目。
   *
   * 没有这一层时，写入后不再被读取的 key 会永久驻留（见 {@link sweep}）；
   * 叠加无鉴权的 `fetch()` 入口，攻击者可写到 DO 内存上限，随后 DO 被驱逐
   * 重启，**全部活跃会话 / challenge / auth code 一起丢失**。
   */
  private evictIfNeeded(): void {
    while (this.store.size > AuthSessionDO.MAX_ENTRIES) {
      let oldestKey: string | null = null;
      let oldest = Infinity;
      for (const [k, v] of this.store) {
        if (v.expiresAt < oldest) {
          oldest = v.expiresAt;
          oldestKey = k;
        }
      }
      if (oldestKey === null) return;
      this.store.delete(oldestKey);
    }
  }

  /**
   * 调度一次清扫 alarm，触发时间不晚于最早到期的条目。
   *
   * 历史实现从未调用 `setAlarm`，导致 `alarm()` 是**死代码** —— 过期项只靠
   * `get()` 惰性清理，即只有"写了之后又被读过"的 key 才会被回收。
   */
  private async scheduleSweep(at: number): Promise<void> {
    const storage = this.ctx?.storage;
    if (!storage?.setAlarm) return;
    try {
      const current = await storage.getAlarm();
      // 已有更早的 alarm 则不推迟它
      if (current === null || current > at) {
        await storage.setAlarm(at);
      }
    } catch {
      // alarm 能力不可用（如测试环境）时静默降级：容量保护仍然生效
    }
  }

  /**
   * 清理所有已过期条目。
   *
   * 由 alarm 触发；`store` 为空时取消 alarm，避免空转。
   */
  async sweep(): Promise<void> {
    const now = Date.now();
    for (const [k, v] of this.store) {
      if (now > v.expiresAt) this.store.delete(k);
    }
    if (this.store.size === 0) {
      const storage = this.ctx?.storage;
      try {
        await storage?.deleteAlarm?.();
      } catch {
        // 忽略
      }
    }
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

  /** Alarm 回调：转发到 {@link sweep}（保持对外的 `alarm()` 约定）。 */
  async alarm(): Promise<void> {
    await this.sweep();
  }

  /**
   * DO 的 HTTP 入口鉴权 —— **fail-closed**。
   *
   * ## 安全语义
   *
   * 本对象保存授权码、magic-link token、WebAuthn challenge 等**一次性凭据**。
   * HTTP 入口一旦可达且无鉴权，`/get` 就是对活跃认证材料的匿名读取原语，
   * `/take` 还能消费（销毁）指定 challenge —— 构成针对单次登录的定向 DoS。
   *
   * 因此**不允许任何"缺配置就放行"的降级**：
   *
   * | AUTH_SESSION_DO_SECRET | 结果 |
   * |---|---|
   * | 未配置 | **503** `missing_config` —— 拒绝服务并说明原因 |
   * | 已配置但请求未带 / 带错 | **401** `unauthorized` |
   * | 已配置且校验通过 | 正常处理 |
   *
   * 首次出现"未配置"时额外打一行 error 日志用于告警，但**请求一定被拒绝** ——
   * 日志只是辅助，不是保护。
   *
   * @returns 拒绝时返回 503/401 响应；放行时返回 `null`
   */
  private async authorized(request: Request): Promise<Response | null> {
    const secret = this.env?.AUTH_SESSION_DO_SECRET;
    if (!present(secret)) {
      if (!AuthSessionDO.warnedMissingSecret) {
        AuthSessionDO.warnedMissingSecret = true;
        console.error(
          "[AuthSessionDO] AUTH_SESSION_DO_SECRET 未注入 —— HTTP 入口已 fail-closed（全部请求 503）。" +
            "请执行 `wrangler secret put AUTH_SESSION_DO_SECRET`，并确认没有公开路由把本 DO 代理出去。",
        );
      }
      return jsonResponse(503, {
        ok: false,
        error: "missing_config",
        code: "CONFIG_MISSING",
        details: [
          {
            kind: "secret",
            name: "AUTH_SESSION_DO_SECRET",
            reason:
              "未注入 —— 本 DO 持有授权码 / magic-link token / WebAuthn challenge，HTTP 入口必须鉴权",
            hint: "wrangler secret put AUTH_SESSION_DO_SECRET",
          },
        ],
      });
    }
    const provided = request.headers.get("X-Session-Secret") ?? "";
    if (!timingSafeEqual(provided, String(secret))) {
      return jsonResponse(401, { ok: false, error: "unauthorized", code: "UNAUTHORIZED" });
    }
    return null;
  }

  /**
   * 校验密钥是否已配置；未配置抛 {@link ConfigError}。
   *
   * 供**不经 HTTP** 的调用方（直接 RPC 调用本 DO 的服务）在启动自检中使用 ——
   * 与 {@link authorized} 共用同一套判定，避免两处标准不一致。
   *
   * @throws {ConfigError} 未配置 AUTH_SESSION_DO_SECRET
   */
  assertConfigured(): void {
    assertConfigured(
      this.env,
      {
        AUTH_SESSION_DO_SECRET: {
          why: "AuthSessionDO 的 HTTP 入口鉴权；本对象持有授权码与 WebAuthn challenge",
        },
      },
      "secret",
      "AuthSessionDO",
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // fail-closed：未配置 → 503（并附缺失清单）；密钥错误 → 401。两者都拒绝。
    const denied = await this.authorized(request);
    if (denied) return denied;
    const json = { "Content-Type": "application/json" };

    if (url.pathname === "/set" && request.method === "POST") {
      const b = (await request.json().catch(() => ({}))) as any;
      // 拒绝缺失/非字符串的 key：否则会写入字面量 "undefined" 键
      const key = typeof b?.key === "string" ? b.key : "";
      if (!key) {
        return new Response(JSON.stringify({ ok: false, error: "bad_request" }), {
          status: 400,
          headers: json,
        });
      }
      const ttl = Number(b?.ttlSec);
      await this.set(key, String(b?.value ?? ""), Number.isFinite(ttl) ? ttl : 300);
      return new Response(JSON.stringify({ ok: true }), { headers: json });
    }
    if (url.pathname === "/get") {
      const key = url.searchParams.get("key") || "";
      const val = await this.get(key);
      return new Response(JSON.stringify({ value: val }), { headers: json });
    }
    if (url.pathname === "/take" && request.method === "POST") {
      const b = (await request.json().catch(() => ({}))) as any;
      const key = typeof b?.key === "string" ? b.key : "";
      const val = await this.take(key);
      return new Response(JSON.stringify({ value: val }), { headers: json });
    }
    if (url.pathname === "/delete" && request.method === "POST") {
      const b = (await request.json().catch(() => ({}))) as any;
      const key = typeof b?.key === "string" ? b.key : "";
      if (key) await this.delete(key);
      return new Response(JSON.stringify({ ok: true }), { headers: json });
    }
    return new Response("Not Found", { status: 404 });
  }
}
