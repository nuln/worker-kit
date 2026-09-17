import { describe, it, expect, vi } from "vitest";
import { AuthSessionDO } from "../src/session/do.js";

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
    const doInstance = new AuthSessionDO({}, {});

    // Expired TTL (negative)
    await doInstance.set("expired_key", "old_val", -10);
    expect(await doInstance.get("expired_key")).toBe(null);

    // Set multiple and run alarm
    await doInstance.set("k_valid", "val", 1000);
    await doInstance.set("k_exp1", "exp", -1);
    await doInstance.set("k_exp2", "exp", -5);

    await doInstance.alarm();
    expect(await doInstance.get("k_valid")).toBe("val");
    expect(await doInstance.get("k_exp1")).toBe(null);
  });

  it("handles HTTP RPC fetch routes (/set, /get, /take, /delete, 404)", async () => {
    const doInstance = new AuthSessionDO({}, {});

    // 1. POST /set
    const setReq = new Request("http://do/set", {
      method: "POST",
      body: JSON.stringify({ key: "token_123", value: "user_abc", ttlSec: 60 }),
    });
    const setRes = await doInstance.fetch(setReq);
    expect(setRes.status).toBe(200);
    expect(await setRes.json()).toEqual({ ok: true });

    // 2. GET /get
    const getReq = new Request("http://do/get?key=token_123");
    const getRes = await doInstance.fetch(getReq);
    expect(await getRes.json()).toEqual({ value: "user_abc" });

    // 3. POST /take
    const takeReq = new Request("http://do/take", {
      method: "POST",
      body: JSON.stringify({ key: "token_123" }),
    });
    const takeRes = await doInstance.fetch(takeReq);
    expect(await takeRes.json()).toEqual({ value: "user_abc" });

    // Verify taken
    const getAgain = await doInstance.fetch(new Request("http://do/get?key=token_123"));
    expect(await getAgain.json()).toEqual({ value: null });

    // 4. POST /delete
    await doInstance.set("del_key", "val", 60);
    const delReq = new Request("http://do/delete", {
      method: "POST",
      body: JSON.stringify({ key: "del_key" }),
    });
    const delRes = await doInstance.fetch(delReq);
    expect(await delRes.json()).toEqual({ ok: true });

    // 5. 404 Route
    const unknownReq = new Request("http://do/unknown");
    const unknownRes = await doInstance.fetch(unknownReq);
    expect(unknownRes.status).toBe(404);
  });
});
