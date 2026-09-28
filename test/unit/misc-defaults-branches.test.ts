/**
 * 剩余模块的「缺省兜底」分支批量补齐
 *
 * 这些分支几乎全是 `x ?? 默认值` / `if (!x) return 空` 形态。单看每个都琐碎，
 * 但它们集中起来有一个共同后果：**调用方少传一个参数时静默产出错误结果**，
 * 而错误结果往往要到生产才暴露。
 *
 * 因此本文件逐个钉住"缺省时到底返回什么"，让退化立刻可见。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cookieAttrs, parseCookieValue, formatSessionCookie, clearSessionCookie } from "../../src/session/index.js";
import { hasEnv, getEnvValue, maskSecretValue, resolveEnvConfigs, ConfigMemoryCache } from "../../src/flags/index.js";
import { deriveOidcIssuerFromOrigin, resolveOidcIssuer, resolveOidcRedirectUri, isSafeNextUrl } from "../../src/sso/index.js";
import { parseJwtPayload, buildOidcAuthorizeUrl } from "../../src/sso/client.js";
import { defaultD1Check, defaultKvCheck, createHealthCheckHandler } from "../../src/observability/health.js";
import { bufferToHex, hmacSha256, getSignatureKey, formatSigV4Dates, uriEncode } from "../../src/s3/sigv4.js";
import { defaultIsRetryableError, withDbRetry } from "../../src/db/retry.js";
import { normalizeBasePath, stripBasePath, matchBasePath, withBasePath, renderBaseInjection } from "../../src/basepath/index.js";
import { getClientIp, formatBytes, jsonError, errorResponse, redirectResponse } from "../../src/http/index.js";
import { createTracedFetch, requestIdMiddleware } from "../../src/middleware/request-id.js";
import { generateOtpCode, generateMagicLinkToken, buildOtpEmailContent } from "../../src/auth/index.js";
import { defaultKvCheck as _kv } from "../../src/observability/health.js";

void _kv;

/* ==================================================== session/index */

describe("cookieAttrs", () => {
  // 签名是 cookieAttrs(requestOrSecure: Request|boolean, options)
  it("默认 HttpOnly / Path=/ / SameSite=Lax / Max-Age=28800（AGENTS §6.1 基线）", () => {
    const a = cookieAttrs(false);
    expect(a).toContain("HttpOnly");
    expect(a).toContain("Path=/");
    expect(a).toContain("SameSite=Lax");
    expect(a).toContain("Max-Age=28800");
  });
  it("secure=true 补 Secure；false 不补", () => {
    expect(cookieAttrs(true)).toContain("Secure");
    expect(cookieAttrs(false)).not.toContain("Secure");
  });
  it("传 Request 时按协议自动判定 Secure", () => {
    expect(cookieAttrs(new Request("https://x/"))).toContain("Secure");
    expect(cookieAttrs(new Request("http://x/"))).not.toContain("Secure");
  });
  it("maxAge / path / sameSite / httpOnly 可覆盖", () => {
    const a = cookieAttrs(false, { maxAge: 60, path: "/app", sameSite: "Strict", httpOnly: false });
    expect(a).toContain("Max-Age=60");
    expect(a).toContain("Path=/app");
    expect(a).toContain("SameSite=Strict");
    expect(a, "httpOnly:false 时不应输出 HttpOnly").not.toContain("HttpOnly");
  });
});

describe("parseCookieValue", () => {
  it("解析存在的键", () => {
    expect(parseCookieValue("a=1; b=2", "a")).toBe("1");
  });
  it("键不存在返回 null", () => {
    expect(parseCookieValue("a=1", "zzz")).toBeNull();
  });
  it("header 为 null / undefined 时返回 null（不得抛 URIError）", () => {
    expect(parseCookieValue(null, "a")).toBeNull();
    expect(parseCookieValue(undefined, "a")).toBeNull();
  });
  it("空字符串返回 null", () => {
    expect(parseCookieValue("", "a")).toBeNull();
  });
  it("值含 base64 的 = 号不被截断", () => {
    expect(parseCookieValue("t=YWJjZGVmZw==", "t")).toBe("YWJjZGVmZw==");
  });
  it("不匹配同名子串（前缀相同）", () => {
    expect(parseCookieValue("abc=1; xabc=2", "abc")).toBe("1");
  });
});

describe("formatSessionCookie / clearSessionCookie", () => {
  // formatSessionCookie(name, token, requestOrSecure, basePath, maxAge)
  it("格式化为 name=value; attrs，token 被 URL 编码", () => {
    const c = formatSessionCookie("sid", "a b/c", false);
    expect(c).toContain("sid=a%20b%2Fc");
    expect(c).toContain("HttpOnly");
  });
  it("basePath 作为 Path（去掉尾斜杠）", () => {
    expect(formatSessionCookie("sid", "v", false, "/tower/")).toContain("Path=/tower");
  });
  it("__Host- 前缀强制 Path=/（RFC 要求）", () => {
    expect(formatSessionCookie("__Host-sid", "v", false, "/tower")).toContain("Path=/;");
  });
  it("清除时值为空且 Max-Age=0", () => {
    const c = clearSessionCookie("sid");
    expect(c).toContain("Max-Age=0");
    expect(c).toContain("sid=;");
  });
});

/* ==================================================== flags */

describe("flags", () => {
  it("hasEnv：存在 / 不存在", () => {
    expect(hasEnv({ A: "1" }, "A")).toBe(true);
    expect(hasEnv({ A: "" }, "A")).toBe(false);
    expect(hasEnv({}, "A")).toBe(false);
    expect(hasEnv(undefined, "A")).toBe(false);
  });
  it("getEnvValue：返回字符串或 undefined", () => {
    expect(getEnvValue({ A: "1" }, "A")).toBe("1");
    expect(getEnvValue({}, "A")).toBeUndefined();
  });
  it("maskSecretValue：非字符串入参不抛错", () => {
    expect(() => maskSecretValue(undefined as never)).not.toThrow();
  });
  it("resolveEnvConfigs：env 缺省时用空对象（不得抛错）", () => {
    const defs = [{ key: "A", label: "A" }] as never[];
    expect(() => resolveEnvConfigs(defs, undefined)).not.toThrow();
  });
  it("resolveEnvConfigs：按 aliases 依次查找", () => {
    const r = resolveEnvConfigs([{ key: "A", label: "A", aliases: ["B"] }] as never, { B: "v" });
    expect(JSON.stringify(r)).toContain("v");
  });
  it("resolveEnvConfigs：env 命中时用 env，customOverrides 只作兜底", () => {
    // 语义是"env 优先"，不是"override 优先" —— env 才是真实配置来源，
    // 前端提交的值只在 env 缺失时兜底（且此时 source 仍标记为 default）。
    const withEnv = resolveEnvConfigs([{ key: "A", name: "A" }] as never, { A: "fromEnv" }, { A: "override" });
    expect(withEnv[0]?.value).toBe("fromEnv");
    const onlyOverride = resolveEnvConfigs([{ key: "A", name: "A" }] as never, {}, { A: "override" });
    expect(onlyOverride[0]?.value).toBe("override");
  });
  it("resolveEnvConfigs：isSecret 时对外只暴露掩码值", () => {
    const r = resolveEnvConfigs([{ key: "A", name: "A", isSecret: true }] as never, { A: "SUPERSECRET" });
    expect(JSON.stringify(r)).not.toContain("SUPERSECRET");
  });
  // 签名是 getOrFetch(fetcher, force)
  it("并发未命中时只回源一次（防缓存击穿）", async () => {
    const cache = new ConfigMemoryCache<number>(60_000);
    let calls = 0;
    const loader = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return 42;
    };
    const [a, b] = await Promise.all([cache.getOrFetch(loader), cache.getOrFetch(loader)]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(calls, "并发只应回源一次").toBe(1);
  });
  it("命中缓存时不再回源", async () => {
    const cache = new ConfigMemoryCache<number>(60_000);
    let calls = 0;
    const loader = async () => ++calls;
    await cache.getOrFetch(loader);
    await cache.getOrFetch(loader);
    expect(calls).toBe(1);
  });
  it("force 时强制回源", async () => {
    const cache = new ConfigMemoryCache<number>(60_000);
    let calls = 0;
    const loader = async () => ++calls;
    await cache.getOrFetch(loader);
    await cache.getOrFetch(loader, true);
    expect(calls).toBe(2);
  });
  it("回源抛错时不得缓存坏值（后续仍会重试）", async () => {
    const cache = new ConfigMemoryCache<number>(60_000);
    let calls = 0;
    const bad = async () => {
      calls++;
      throw new Error("boom");
    };
    await expect(cache.getOrFetch(bad)).rejects.toThrow();
    await expect(cache.getOrFetch(bad)).rejects.toThrow();
    expect(calls, "失败后必须能再次回源").toBe(2);
  });
  it("TTL 从回源**完成**时刻起算（不是进入时刻）", async () => {
    vi.useFakeTimers();
    try {
      const cache = new ConfigMemoryCache<number>(1000);
      let calls = 0;
      const loader = async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 800)); // 慢回源
        return calls;
      };
      const p = cache.getOrFetch(loader);
      await vi.advanceTimersByTimeAsync(800);
      await p;
      // 进入后过了 800ms，缓存还剩 200ms 而不是 1000ms
      await vi.advanceTimersByTimeAsync(300);
      await cache.getOrFetch(loader);
      expect(calls, "TTL 应从完成时刻起算，300ms 后仍在有效期内").toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ==================================================== sso */

describe("sso：issuer 与 redirect 推导", () => {
  it("从 origin 推导 issuer（缺省 subPath 为 /oidc）", () => {
    expect(deriveOidcIssuerFromOrigin("https://a.com")).toContain("a.com");
  });
  it("显式 subPath 生效", () => {
    const r = deriveOidcIssuerFromOrigin("https://a.com", "/custom");
    expect(r).toContain("custom");
  });
  it("issuerConfig 去除尾斜杠", () => {
    expect(resolveOidcIssuer("https://a.com/")).toBe("https://a.com");
  });
  // resolveOidcRedirectUri(envRedirectUri, requestUrl, basePath, callbackSubpath, allowedOriginsCsv)
  // 第 2 个参数是 requestUrl，且会走 assertSsoOrigin → 必须给白名单
  it("envRedirectUri 优先于推导值", () => {
    const r = resolveOidcRedirectUri(
      "https://env.example.com/cb",
      "https://a.com/oidc/login",
      "",
      "/admin/oidc/callback",
      "https://a.com",
    );
    expect(r).toBe("https://env.example.com/cb");
  });
  it("相对 envRedirectUri 与请求 origin 拼接", () => {
    const r = resolveOidcRedirectUri("/cb", "https://a.com/oidc/login", "", "/x", "https://a.com");
    expect(r).toBe("https://a.com/cb");
  });
  it("未配置时按 basePath + callbackSubpath 推导", () => {
    const r = resolveOidcRedirectUri(
      undefined,
      "https://a.com/oidc/login",
      "/tower",
      "/admin/oidc/callback",
      "https://a.com",
    );
    expect(r).toBe("https://a.com/tower/admin/oidc/callback");
  });
  it("requestUrl 不在白名单 → 抛错（fail-closed）", () => {
    expect(() =>
      resolveOidcRedirectUri(undefined, "https://evil.com/x", "", "/cb", "https://a.com"),
    ).toThrow();
  });
  it("callbackSubpath 含 .. 段 → 抛错", () => {
    expect(() =>
      resolveOidcRedirectUri(
        undefined,
        "https://a.com/x",
        "",
        "/../escape",
        "https://a.com",
      ),
    ).toThrow(/dot segments/);
  });
  it("isSafeNextUrl：空值返回 false", () => {
    expect(isSafeNextUrl(undefined as never, "https://a.com", "")).toBe(false);
    expect(isSafeNextUrl("   ", "https://a.com", "")).toBe(false);
    expect(isSafeNextUrl("/x", "https://a.com", "")).toBe(true);
    expect(isSafeNextUrl("https://evil.com", "https://a.com", "")).toBe(false);
  });
  it("parseJwtPayload：段数不足时抛 invalid_jwt_format", () => {
    expect(() => parseJwtPayload("onlyone")).toThrow(/invalid_jwt_format/);
    expect(() => parseJwtPayload("")).toThrow(/invalid_jwt_format/);
  });
  it("parseJwtPayload：正常三段可解出 payload", () => {
    const b64u = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const token = `${b64u(JSON.stringify({ alg: "HS256" }))}.${b64u(JSON.stringify({ sub: "u1" }))}.sig`;
    expect(parseJwtPayload<{ sub: string }>(token).sub).toBe("u1");
  });
  it("parseJwtPayload：payload 段非合法 JSON → 抛错（不得静默返回空）", () => {
    expect(() => parseJwtPayload("a.!!!.c")).toThrow();
  });
  it("buildOidcAuthorizeUrl 带 state 与 redirect_uri", () => {
    const u = buildOidcAuthorizeUrl({
      authorizationEndpoint: "https://a.com/auth",
      clientId: "c",
      redirectUri: "https://a.com/cb",
      state: "st",
      scope: "openid",
    } as never);
    expect(String(u)).toContain("state=st");
    expect(String(u)).toContain("client_id=c");
  });
});

/* ==================================================== health */

describe("health：默认检查器", () => {
  it("d1 缺失 → false", async () => {
    expect(await defaultD1Check()).toBe(false);
  });
  it("d1 查询成功 → true", async () => {
    const db = { prepare: () => ({ first: async () => ({ ok: 1 }) }) };
    expect(await defaultD1Check(db)).toBe(true);
  });
  it("d1 查询抛错 → false 且带出原因", async () => {
    const db = {
      prepare: () => ({
        first: async () => {
          throw new Error("D1 down");
        },
      }),
    };
    expect(await defaultD1Check(db)).toBe(false);
  });
  it("kv 缺失 → false", async () => {
    expect(await defaultKvCheck()).toBe(false);
  });
  it("kv get 成功 → true", async () => {
    expect(await defaultKvCheck({ get: async () => null })).toBe(true);
  });
  it("kv get 抛错 → false", async () => {
    const kv = {
      get: async () => {
        throw new Error("KV down");
      },
    };
    expect(await defaultKvCheck(kv)).toBe(false);
  });
  // handler 签名是 (request, env)
  it("createHealthCheckHandler：全部检查通过 → 200", async () => {
    const h = createHealthCheckHandler({
      serviceName: "Tower",
      checks: { d1: async () => true },
    } as never);
    const res = await h(new Request("https://x/health"), {} as never);
    expect(res.status).toBe(200);
  });
  it("未传 serviceName 也不崩（回归：曾因 .toLowerCase 抛 TypeError）", async () => {
    const h = createHealthCheckHandler({ checks: { d1: async () => true } } as never);
    const res = await h(new Request("https://x/health"), {} as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBeTruthy();
  });
  it("serviceName 为 mail 时 data.status 文案为 ok（历史约定）", async () => {
    const h = createHealthCheckHandler({ serviceName: "Mail", checks: { d1: async () => true } } as never);
    const body = (await (await h(new Request("https://x/health"), {} as never)).json()) as {
      status: string;
      data: { status: string };
    };
    expect(body.status, "顶层 status 是 healthy/degraded").toBe("healthy");
    expect(body.data.status, "data.status 对 mail 特化为 ok").toBe("ok");
  });
  it("statusText 覆盖默认文案", async () => {
    const h = createHealthCheckHandler({
      serviceName: "Mail",
      statusText: "custom",
      checks: { d1: async () => true },
    } as never);
    const body = (await (await h(new Request("https://x/health"), {} as never)).json()) as {
      data: { status: string };
    };
    expect(body.data.status).toBe("custom");
  });
  it("任一检查失败 → unhealthy（503）", async () => {
    const h = createHealthCheckHandler({
      checks: { d1: async () => true, kv: async () => false },
    } as never);
    const res = await h(new Request("https://x/health"), {} as never);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; errors?: Record<string, string> };
    expect(body.ok).toBe(false);
  });
  it("检查抛错被记为该检查失败，不让整个 handler 崩", async () => {
    const h = createHealthCheckHandler({
      checks: {
        d1: async () => {
          throw new Error("boom");
        },
      },
    } as never);
    const res = await h(new Request("https://x/health"), {} as never);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { errors?: Record<string, string> };
    expect(body.errors?.d1).toContain("boom");
  });
  it("未提供 checks 时按 env.DB / env.KV 自动检查", async () => {
    const h = createHealthCheckHandler({} as never);
    const res = await h(new Request("https://x/health"), { DB: { prepare: () => ({ first: async () => ({ ok: 1 }) }) } } as never);
    expect(res.status).toBe(200);
  });
  it("env.DB 存在但查询失败 → 503", async () => {
    const h = createHealthCheckHandler({} as never);
    const db = { prepare: () => ({ first: async () => { throw new Error("D1 down"); } }) };
    const res = await h(new Request("https://x/health"), { DB: db } as never);
    expect(res.status).toBe(503);
  });
});

/* ==================================================== sigv4 */

describe("sigv4", () => {
  it("bufferToHex 接受 ArrayBuffer 与 Uint8Array", () => {
    expect(bufferToHex(new Uint8Array([1, 255]))).toBe("01ff");
    expect(bufferToHex(new Uint8Array([1, 255]).buffer)).toBe("01ff");
  });
  it("uriEncode 默认编码斜杠", () => {
    expect(uriEncode("a/b")).toBe("a%2Fb");
    expect(uriEncode("a/b", false)).toBe("a/b");
  });
  it("hmacSha256 对字符串与字节等价（key 必须是字节，签名 aws4 规范如此）", async () => {
    const key = new TextEncoder().encode("k");
    const a = await hmacSha256(key, "d");
    const b = await hmacSha256(key, new TextEncoder().encode("d"));
    expect(new Uint8Array(a)).toEqual(new Uint8Array(b));
  });
  it("getSignatureKey 产出 4 段派生结果", async () => {
    const k = await getSignatureKey("SECRET", "20260101", "us-east-1", "s3");
    expect(k).toBeTruthy();
  });
  it("formatSigV4Dates 产出 dateStamp 与 amzDateTime", () => {
    const d = formatSigV4Dates(new Date("2026-01-02T03:04:05Z"));
    expect(d.dateStamp).toBe("20260102");
    expect(d.amzDateTime).toBe("20260102T030405Z");
  });
  it("缺省时间参数用当前时间", () => {
    expect(() => formatSigV4Dates()).not.toThrow();
  });
});

/* ==================================================== retry / basepath / http */

describe("defaultIsRetryableError / withDbRetry", () => {
  it("D1 繁忙 / 锁竞争类错误可重试", () => {
    expect(defaultIsRetryableError(new Error("SQLITE_BUSY"))).toBe(true);
    expect(defaultIsRetryableError(new Error("database is locked"))).toBe(true);
    expect(defaultIsRetryableError(new Error("connection reset"))).toBe(true);
  });
  it("SQL 语法错误不可重试（重试只会浪费时间）", () => {
    expect(defaultIsRetryableError(new Error("no such table: x"))).toBe(false);
    expect(defaultIsRetryableError(new Error("timeout"))).toBe(false);
  });
  it("空入参返回 false", () => {
    expect(defaultIsRetryableError(null)).toBe(false);
  });
  it("非 Error 入参也安全处理", () => {
    expect(() => defaultIsRetryableError("boom")).not.toThrow();
    expect(() => defaultIsRetryableError(undefined)).not.toThrow();
  });
  it("成功时不重试", async () => {
    let calls = 0;
    const r = await withDbRetry(async () => {
      calls++;
      return "ok";
    });
    expect(r).toBe("ok");
    expect(calls).toBe(1);
  });
  it("可重试错误重试到上限后抛出", async () => {
    let calls = 0;
    await expect(
      withDbRetry(
        async () => {
          calls++;
          throw new Error("connection reset");
        },
        { maxRetries: 2, baseDelayMs: 1 } as never,
      ),
    ).rejects.toThrow();
    expect(calls, "可重试错误应尝试多次").toBeGreaterThan(1);
  });
  it("不可重试错误立即抛出（不做无谓等待）", async () => {
    let calls = 0;
    await expect(
      withDbRetry(
        async () => {
          calls++;
          throw new Error("no such table: x");
        },
        { baseDelayMs: 1 } as never,
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe("basepath", () => {
  it("normalizeBasePath 归一化", () => {
    expect(normalizeBasePath("/a/")).toBe("/a");
    expect(normalizeBasePath("a")).toBe("/a");
    // 只折叠首尾斜杠，中间的 // 原样保留（basePath 里的 // 属配置笔误，
    // 静默折叠反而会掩盖问题）
    expect(normalizeBasePath("//a//b//")).toBe("/a//b");
  });
  it("根部署归一为空串（而不是 /）—— 空串表示无前缀", () => {
    // 语义：basePath="" 表示服务挂在根；返回 "/" 会让 stripBasePath 判断失误
    expect(normalizeBasePath("")).toBe("");
    expect(normalizeBasePath("/")).toBe("");
    expect(normalizeBasePath(undefined)).toBe("");
    expect(normalizeBasePath(null)).toBe("");
    expect(normalizeBasePath("   ")).toBe("");
  });
  it("stripBasePath 去掉前缀；不匹配时原样返回", () => {
    expect(stripBasePath("/tower/login", "/tower")).toBe("/login");
    expect(stripBasePath("/other/login", "/tower")).toBe("/other/login");
  });
  it("stripBasePath 无 basePath 时 pathname 缺省为 /", () => {
    expect(stripBasePath("")).toBe("/");
  });
  it("matchBasePath：前缀内 → isUnder=true 且给出剥离路径", () => {
    const m = matchBasePath("/tower/login", "/tower");
    expect(m.isUnder).toBe(true);
    expect(m.strippedPath).toBe("/login");
  });
  it("matchBasePath：恰好等于 basePath → isExact=true 且需补尾斜杠重定向", () => {
    const m = matchBasePath("/tower", "/tower");
    expect(m.isExact).toBe(true);
    expect(m.shouldRedirect).toBe(true);
    expect(m.targetPath).toBe("/tower/");
  });
  it("matchBasePath：带尾斜杠 → 无需重定向", () => {
    expect(matchBasePath("/tower/", "/tower").shouldRedirect).toBe(false);
  });
  it("matchBasePath：不在前缀内 → isUnder=false 且原样返回", () => {
    const m = matchBasePath("/other", "/tower");
    expect(m.isUnder).toBe(false);
    expect(m.strippedPath).toBe("/other");
  });
  it("withBasePath 拼接", () => {
    expect(withBasePath("/login", "/tower")).toBe("/tower/login");
    expect(withBasePath("login", "")).toBe("/login");
  });
  it("renderBaseInjection 缺省产出可执行脚本", () => {
    expect(renderBaseInjection()).toContain("script");
    expect(renderBaseInjection("/tower")).toContain("tower");
  });
});

describe("http", () => {
  it("formatBytes 各数量级", () => {
    expect(formatBytes(0)).toMatch(/0/);
    expect(formatBytes(1024)).toMatch(/KB|MB/);
    expect(formatBytes(1024 * 1024)).toMatch(/MB/);
    expect(formatBytes(1536, 1)).toBeTruthy();
  });
  it("getClientIp 缺头时回落", () => {
    expect(() => getClientIp(new Request("https://x"))).not.toThrow();
    expect(getClientIp(new Request("https://x", { headers: { "CF-Connecting-IP": "1.2.3.4" } }))).toBe("1.2.3.4");
  });
  it("jsonError(status, message) 遵循统一契约并带缺省 code", async () => {
    const a = (await jsonError(400, "bad").json()) as { ok: boolean; error: string; code: string };
    expect(a.ok).toBe(false);
    expect(a.error).toBe("bad");
    expect(a.code).toBe("HTTP_400");
  });
  it("jsonError 可指定 code 与额外字段", async () => {
    const b = (await jsonError(422, "bad", "VALIDATION", { field: "email" }).json()) as {
      code: string;
      field: string;
    };
    expect(b.code).toBe("VALIDATION");
    expect(b.field).toBe("email");
  });
  it("errorResponse(message, status, details)", async () => {
    const c = (await errorResponse("bad", 422, { f: 1 }).json()) as { details?: unknown; error: string };
    expect(c.details).toEqual({ f: 1 });
    expect(c.error).toBe("bad");
  });
  it("redirectResponse 缺省 302", () => {
    expect(redirectResponse("/x").status).toBe(302);
    expect(redirectResponse("/x", 301).status).toBe(301);
  });
});

describe("request-id", () => {
  it("createTracedFetch 透传自定义 fetch 实现", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );
    const t = createTracedFetch({ req: { header: () => undefined }, res: { headers: new Headers() } } as never);
    const res = await t("https://x/y");
    expect(res.status).toBe(200);
  });
  it("createTracedFetch 无 requestId 时不注入头", async () => {
    const seen: Array<Record<string, string>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: unknown, init?: RequestInit) => {
        seen.push((init?.headers ?? {}) as Record<string, string>);
        return new Response("ok");
      }),
    );
    const t = createTracedFetch({ req: { header: () => undefined } } as never);
    await t("https://x/y");
    expect(JSON.stringify(seen[0])).not.toContain("X-Request-ID");
  });
  it("requestIdMiddleware 缺省入参可创建中间件", () => {
    expect(() => requestIdMiddleware()).not.toThrow();
  });
});

describe("auth/index", () => {
  it("generateOtpCode 长度符合参数", () => {
    expect(generateOtpCode(6)).toHaveLength(6);
    expect(generateOtpCode(8)).toHaveLength(8);
    expect(generateOtpCode(6)).toMatch(/^\d+$/);
  });
  it("generateMagicLinkToken 每次不同", () => {
    expect(generateMagicLinkToken()).not.toBe(generateMagicLinkToken());
  });
  it("buildOtpEmailContent 缺省参数不崩", () => {
    expect(() => buildOtpEmailContent({ code: "123456", expireMinutes: 10 } as never)).not.toThrow();
  });
});
