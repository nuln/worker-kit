import { describe, it, expect } from "vitest";
import {
  cookieAttrs,
  parseCookieValue,
  formatSessionCookie,
} from "../src/session/index";

describe("@nuln/worker-kit/session", () => {
  it("cookieAttrs: 默认 Lax/HttpOnly/Path=/ + https 自动 Secure", () => {
    const https = new Request("https://x.test/");
    const attrs = cookieAttrs(https);
    expect(attrs).toContain("Path=/");
    expect(attrs).toContain("SameSite=Lax");
    expect(attrs).toContain("HttpOnly");
    expect(attrs).toContain("Secure");
    expect(attrs).toContain("Max-Age=28800");
  });

  it("cookieAttrs: http 不加 Secure，可显式覆盖", () => {
    expect(cookieAttrs(new Request("http://x.test/"))).not.toContain("Secure");
    expect(cookieAttrs(false, { maxAge: 60, path: "/tower" })).toContain(
      "Max-Age=60",
    );
    expect(cookieAttrs(false, { path: "/tower" })).toContain("Path=/tower");
  });

  it("parseCookieValue: 解析与 decode", () => {
    expect(parseCookieValue("a=1; sid=abc%202", "sid")).toBe("abc 2");
    expect(parseCookieValue(null, "sid")).toBeNull();
    expect(parseCookieValue("a=1", "missing")).toBeNull();
  });

  it("formatSessionCookie: __Host- 强制 Path=/", () => {
    const c = formatSessionCookie("__Host-sid", "tok", true, "/tower");
    expect(c.startsWith("__Host-sid=tok;")).toBe(true);
    expect(c).toContain("Path=/;");
    expect(c).not.toContain("Path=/tower");
  });

  it("formatSessionCookie: 普通名使用 basePath", () => {
    const c = formatSessionCookie("tower_sid", "tok", false, "/tower");
    expect(c).toContain("Path=/tower");
    expect(c).not.toContain("Secure");
  });

  it("AuthSessionDO: 状态读写与单次 CAS 消费 (take)", async () => {
    const { AuthSessionDO } = await import("../src/session/do.js");
    const store = new AuthSessionDO({}, {});
    await store.set("token_1", "user_100", 60);

    expect(await store.get("token_1")).toBe("user_100");
    // 单次原子消费
    expect(await store.take("token_1")).toBe("user_100");
    // 再次读取已被清空
    expect(await store.get("token_1")).toBeNull();
    expect(await store.take("token_1")).toBeNull();
  });
});
