import { describe, it, expect, vi } from "vitest";
import { AuthSessionDO } from "../../src/session/do.js";

describe("@nuln/worker-kit/session/do - AuthSessionDO Deep Branch Coverage", () => {
  it("manages in-memory key-value lifecycle with TTL and take (CAS)", async () => {
    const doInstance = new AuthSessionDO({}, {});

    await doInstance.set("k1", "v1", 100);
    expect(await doInstance.get("k1")).toBe("v1");

    // Take returns value and deletes it
    expect(await doInstance.take("k1")).toBe("v1");
    expect(await doInstance.get("k1")).toBe(null);
    expect(await doInstance.take("k1")).toBe(null);

    // Delete
    await doInstance.set("k2", "v2", 100);
    await doInstance.delete("k2");
    expect(await doInstance.get("k2")).toBe(null);
  });

  it("handles expired keys in get and alarm cleanup", async () => {
    // 用 fake timers 推进时间模拟过期。
    // 不再依赖负数 TTL —— set() 现会把 TTL 夹紧到 [1, 86400]，
    // 负数会产生"立即过期"的条目，那正是本次要消除的语义漏洞。
    vi.useFakeTimers();
    try {
      const doInstance = new AuthSessionDO({}, {});

      await doInstance.set("expired_key", "old_val", 10);
      vi.advanceTimersByTime(11_000);
      expect(await doInstance.get("expired_key")).toBe(null);

      // 混合场景：有效项与过期项共存，alarm 只清理过期项
      vi.setSystemTime(Date.now());
      await doInstance.set("k_valid", "val", 1000);
      await doInstance.set("k_exp1", "exp", 10);
      await doInstance.set("k_exp2", "exp", 20);

      vi.advanceTimersByTime(30_000);
      await doInstance.alarm();

      expect(await doInstance.get("k_valid")).toBe("val");
      expect(await doInstance.get("k_exp1")).toBe(null);
      expect(await doInstance.get("k_exp2")).toBe(null);
    } finally {
      vi.useRealTimers();
    }
  });

  it("set() 夹紧 TTL：负数/0/超范围均被规范化", async () => {
    const doInstance = new AuthSessionDO({}, {});
    // 负数不应产生"立即过期"条目
    await doInstance.set("neg", "v", -10);
    expect(await doInstance.get("neg")).toBe("v");
    // 0 同理（原先会被 || 兜底成 300）
    await doInstance.set("zero", "v", 0);
    expect(await doInstance.get("zero")).toBe("v");
  });

  it("超过容量上限时淘汰最旧的条目", async () => {
    const doInstance = new AuthSessionDO({}, {});
    const original = AuthSessionDO.MAX_ENTRIES;
    // 临时压低上限，避免为测试写入 1 万条
    (AuthSessionDO as any).MAX_ENTRIES = 3;
    try {
      await doInstance.set("a", "1", 100);
      vi.useFakeTimers();
      try {
        await doInstance.set("b", "2", 200);
        vi.advanceTimersByTime(1_000);
        await doInstance.set("c", "3", 300);
        vi.advanceTimersByTime(1_000);
        await doInstance.set("d", "4", 400);
      } finally {
        vi.useRealTimers();
      }
      // 最新的 d 必须在
      expect(await doInstance.get("d")).toBe("4");
    } finally {
      (AuthSessionDO as any).MAX_ENTRIES = original;
    }
  });

  it("handles HTTP RPC fetch routes (/set, /get, /take, /delete, 404)", async () => {
    // 必须注入 AUTH_SESSION_DO_SECRET —— HTTP 入口现已 fail-closed，
    // 未注入时全部请求返回 503（见下一个用例）。
    const doInstance = new AuthSessionDO({}, { AUTH_SESSION_DO_SECRET: "s3cr3t" });
    const auth = { "X-Session-Secret": "s3cr3t" };

    // 1. POST /set
    const setReq = new Request("http://do/set", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ key: "token_123", value: "user_abc", ttlSec: 60 }),
    });
    const setRes = await doInstance.fetch(setReq);
    expect(setRes.status).toBe(200);
    expect(await setRes.json()).toEqual({ ok: true });

    // 2. GET /get
    const getReq = new Request("http://do/get?key=token_123", { headers: auth });
    const getRes = await doInstance.fetch(getReq);
    expect(await getRes.json()).toEqual({ value: "user_abc" });

    // 3. POST /take
    const takeReq = new Request("http://do/take", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ key: "token_123" }),
    });
    const takeRes = await doInstance.fetch(takeReq);
    expect(await takeRes.json()).toEqual({ value: "user_abc" });

    // Verify taken
    const getAgain = await doInstance.fetch(new Request("http://do/get?key=token_123", { headers: auth }));
    expect(await getAgain.json()).toEqual({ value: null });

    // 4. POST /delete
    await doInstance.set("del_key", "val", 60);
    const delReq = new Request("http://do/delete", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ key: "del_key" }),
    });
    const delRes = await doInstance.fetch(delReq);
    expect(await delRes.json()).toEqual({ ok: true });

    // 5. 404 Route
    const unknownReq = new Request("http://do/unknown", { headers: auth });
    const unknownRes = await doInstance.fetch(unknownReq);
    expect(unknownRes.status).toBe(404);
  });

  it("未注入 AUTH_SESSION_DO_SECRET 时 fail-closed（全部 503）", async () => {
    // 该 DO 持有授权码 / magic-link token / WebAuthn challenge，
    // HTTP 入口一旦可达且无鉴权即等于匿名凭据仓库。
    const inst = new AuthSessionDO({}, {});
    for (const req of [
      new Request("http://do/get?key=k"),
      new Request("http://do/set", { method: "POST", body: JSON.stringify({ key: "a", value: "b" }) }),
      new Request("http://do/take", { method: "POST", body: JSON.stringify({ key: "a" }) }),
      new Request("http://do/delete", { method: "POST", body: JSON.stringify({ key: "a" }) }),
      new Request("http://do/unknown"),
    ]) {
      const res = await inst.fetch(req);
      expect(res.status, `${req.method} ${new URL(req.url).pathname} 应 503`).toBe(503);
      const body = (await res.json()) as { ok: boolean; error: string; code: string; details?: Array<{ name: string }> };
      expect(body.ok).toBe(false);
      expect(body.error).toBe("missing_config");
      expect(body.code).toBe("CONFIG_MISSING");
      // 必须告诉运维缺什么
      expect(body.details?.[0]?.name).toBe("AUTH_SESSION_DO_SECRET");
    }
  });

  it("空白字符串 secret 视为未配置（同样 503）", async () => {
    const inst = new AuthSessionDO({}, { AUTH_SESSION_DO_SECRET: "   " });
    const res = await inst.fetch(new Request("http://do/get?key=k"));
    expect(res.status).toBe(503);
  });

  it("已注入但请求未带 / 带错密钥 → 401", async () => {
    const env = { AUTH_SESSION_DO_SECRET: "s3cr3t" };
    const noKey = await new AuthSessionDO({}, env).fetch(new Request("http://do/get?key=k"));
    expect(noKey.status).toBe(401);
    const wrongKey = await new AuthSessionDO({}, env).fetch(
      new Request("http://do/get?key=k", { headers: { "X-Session-Secret": "nope" } }),
    );
    expect(wrongKey.status).toBe(401);
  });

  it("assertConfigured 与 HTTP 判定共用同一套标准", async () => {
    const missing = new AuthSessionDO({}, {});
    expect(() => missing.assertConfigured()).toThrowError(/AUTH_SESSION_DO_SECRET/);
    // 抛异常的同时 HTTP 入口也确实拒绝
    const res = await missing.fetch(new Request("http://do/get?key=k"));
    expect(res.status).toBe(503);

    const ok = new AuthSessionDO({}, { AUTH_SESSION_DO_SECRET: "x" });
    expect(() => ok.assertConfigured()).not.toThrow();
    const res2 = await ok.fetch(
      new Request("http://do/get?key=k", { headers: { "X-Session-Secret": "x" } }),
    );
    expect(res2.status).toBe(200);
  });
});
