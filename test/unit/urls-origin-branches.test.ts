/**
 * URL / Origin 归一化与重定向校验的分支补齐
 *
 * 这些函数是 SSRF 与开放重定向的防线，边界判定（loopback、userinfo、
 * fragment、协议白名单）一旦走错就是可利用的口子，因此逐条钉死。
 */

import { describe, it, expect } from "vitest";
import {
  normalizeOrigin,
  isLoopbackHostname,
  normalizeSubPath,
  normalizeIssuerUrl,
  parseOriginAllowlist,
  resolveIssuer,
  normalizeRedirectUri,
  isRedirectUriAllowed,
  selectRpId,
  isSafeNextUrl,
  isSsoOriginAllowed,
  assertSsoOrigin,
} from "../../src/urls/origin.js";

describe("normalizeOrigin", () => {
  it("去掉尾斜杠", () => {
    expect(normalizeOrigin("https://a.com/")).toBe("https://a.com");
  });
  it("保持无尾斜杠的输入不变", () => {
    expect(normalizeOrigin("https://a.com")).toBe("https://a.com");
  });
  it("小写化 host", () => {
    expect(normalizeOrigin("https://A.COM")).toBe("https://a.com");
  });
  it("丢弃 path 与 query（origin 语义就是 origin）", () => {
    expect(normalizeOrigin("https://a.com/oidc/?x=1#h")).toBe("https://a.com");
  });
  it("拒绝带 userinfo 的 origin", () => {
    expect(() => normalizeOrigin("https://u:p@a.com")).toThrow(/userinfo/i);
  });
  it("带端口时保留端口", () => {
    expect(normalizeOrigin("https://a.com:8443/")).toBe("https://a.com:8443");
  });
  it("空值抛错（URL 构造失败），不得静默返回字符串", () => {
    expect(() => normalizeOrigin("")).toThrow();
    expect(() => normalizeOrigin(undefined as never)).toThrow();
  });
  it("非法 URL 抛错而非静默返回", () => {
    expect(() => normalizeOrigin("not a url")).toThrow();
  });
});

describe("isLoopbackHostname", () => {
  it("识别 IPv4 loopback", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("127.1.2.3")).toBe(true);
  });
  it("只认精确的 localhost（子域不算）", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("app.localhost")).toBe(false);
    expect(isLoopbackHostname("localhost.evil.com")).toBe(false);
  });
  it("识别 RFC1918 私网段（文档明确包含）", () => {
    expect(isLoopbackHostname("10.0.0.1")).toBe(true);
    expect(isLoopbackHostname("192.168.1.1")).toBe(true);
    expect(isLoopbackHostname("172.16.0.1")).toBe(true);
    expect(isLoopbackHostname("172.31.255.255")).toBe(true);
    expect(isLoopbackHostname("172.32.0.1")).toBe(false);
  });
  it("识别 IPv6 loopback（带方括号与不带）", () => {
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
  });
  it("拒绝公网地址与相似字符串（回归：前缀式匹配曾让 127.evil.com 通过）", () => {
    // 回归用例：原判定用 `/^127\./`，只锚定前缀，于是注册 `127.evil.com`
    // 就能冒充回环 —— 而本函数是 normalizeRedirectUri 里
    // "允许 http:// 回调"的唯一依据，等于开了明文回调的口子。
    expect(isLoopbackHostname("a.com")).toBe(false);
    expect(isLoopbackHostname("127.evil.com")).toBe(false);
    expect(isLoopbackHostname("127.0.0.1.evil.com")).toBe(false);
    expect(isLoopbackHostname("10.evil.com")).toBe(false);
    expect(isLoopbackHostname("192.168.evil.com")).toBe(false);
    expect(isLoopbackHostname("")).toBe(false);
  });
  it("大小写不敏感", () => {
    expect(isLoopbackHostname("LOCALHOST")).toBe(true);
  });
});

describe("normalizeSubPath", () => {
  it("补前导斜杠", () => {
    expect(normalizeSubPath("oidc")).toBe("/oidc");
  });
  it("折叠重复斜杠", () => {
    expect(normalizeSubPath("//a//b")).toBe("/a/b");
  });
  it("去尾斜杠（根路径归一为空串）", () => {
    expect(normalizeSubPath("/a/")).toBe("/a");
    expect(normalizeSubPath("/")).toBe("");
  });
  it("空值 → 空串", () => {
    expect(normalizeSubPath("")).toBe("");
    expect(normalizeSubPath(undefined)).toBe("");
    expect(normalizeSubPath(null)).toBe("");
  });
});

describe("normalizeIssuerUrl", () => {
  it("去尾斜杠", () => {
    expect(normalizeIssuerUrl("https://a.com/oidc/")).toBe("https://a.com/oidc");
  });
  it("非法 URL 抛错", () => {
    expect(() => normalizeIssuerUrl("::::")).toThrow();
  });
});

describe("parseOriginAllowlist", () => {
  it("逗号分隔字符串", () => {
    expect(parseOriginAllowlist("https://a.com,https://b.com")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });
  it("通配符 * 单独处理", () => {
    expect(parseOriginAllowlist("*")).toEqual(["*"]);
  });
  it("非法项原样保留（后续校验拦截），不静默丢弃", () => {
    expect(parseOriginAllowlist("::::")).toEqual(["::::"]);
  });
  it("去重", () => {
    expect(parseOriginAllowlist("https://a.com,https://a.com")).toEqual(["https://a.com"]);
  });
  it("非法 defaultOrigin 被忽略而非抛错", () => {
    expect(() => parseOriginAllowlist("https://a.com", "::::")).not.toThrow();
  });
  it("忽略空白项与空串", () => {
    expect(parseOriginAllowlist(" https://a.com , ,https://b.com ")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });
  it("未配置时返回空数组", () => {
    expect(parseOriginAllowlist(undefined)).toEqual([]);
    expect(parseOriginAllowlist("")).toEqual([]);
  });
  it("可选的兜底 origin 只在配置了才生效", () => {
    expect(parseOriginAllowlist(undefined, "https://fallback.com")).toEqual([
      "https://fallback.com",
    ]);
  });
});

describe("normalizeRedirectUri：安全边界", () => {
  it("合法 https 归一化", () => {
    expect(normalizeRedirectUri("https://a.com/cb")).toBe("https://a.com/cb");
  });
  it("拒绝带 userinfo 的 URI（钓鱼手法）", () => {
    expect(() => normalizeRedirectUri("https://user:pass@a.com/cb")).toThrow(
      /userinfo|user/i,
    );
  });
  it("拒绝带 fragment 的 URI", () => {
    expect(() => normalizeRedirectUri("https://a.com/cb#frag")).toThrow(/fragment/i);
  });
  it("非 https 且非 loopback → 拒绝", () => {
    expect(() => normalizeRedirectUri("http://a.com/cb")).toThrow();
  });
  it("loopback 允许 http（本地开发）", () => {
    expect(() => normalizeRedirectUri("http://localhost:8787/cb")).not.toThrow();
  });
  it("非法 URL 抛错", () => {
    expect(() => normalizeRedirectUri("not-a-url")).toThrow();
  });
});

describe("isRedirectUriAllowed", () => {
  // 参数顺序是 (clientRedirectUris, requestedUri)
  it("精确匹配放行", () => {
    expect(isRedirectUriAllowed("https://a.com/cb", "https://a.com/cb")).toBe(true);
  });
  it("不匹配时拒绝", () => {
    expect(isRedirectUriAllowed("https://a.com/cb", "https://evil.com/cb")).toBe(false);
  });
  it("JSON 数组形式的允许列表", () => {
    expect(isRedirectUriAllowed('["https://a.com/cb"]', "https://a.com/cb")).toBe(true);
    expect(isRedirectUriAllowed('["https://a.com/cb"]', "https://evil.com")).toBe(false);
  });
  it("未配置允许列表 → 拒绝（fail-closed）", () => {
    expect(isRedirectUriAllowed("", "https://a.com/cb")).toBe(false);
    expect(isRedirectUriAllowed(undefined as never, "https://a.com/cb")).toBe(false);
  });
  it("不得把子串当成匹配（前缀相同但路径不同）", () => {
    expect(isRedirectUriAllowed("https://a.com/cb", "https://a.com/cb2")).toBe(false);
  });
});

describe("selectRpId", () => {
  it("hostname 精确命中配置项", () => {
    expect(selectRpId("a.com", ["a.com", "b.com"])).toBe("a.com");
  });
  it("子域命中父域配置", () => {
    expect(selectRpId("x.a.com", ["a.com"])).toBe("a.com");
  });
  it("无命中抛错（不得静默挑一个或返回空串）", () => {
    expect(() => selectRpId("evil.com", ["a.com"])).toThrow(/no matching/i);
    expect(() => selectRpId("a.com", [])).toThrow(/no matching/i);
  });
  it("IP 字面量必须精确匹配（不允许后缀回退）", () => {
    expect(() => selectRpId("1.2.3.4", ["2.3.4"])).toThrow(/ip literal/i);
  });
  it("大小写不敏感", () => {
    expect(selectRpId("A.com", ["a.com"])).toBe("a.com");
  });
});

describe("isSafeNextUrl", () => {
  it("相对路径安全", () => {
    expect(isSafeNextUrl("/admin", "https://a.com", "")).toBe(true);
  });
  it("同源绝对 URL 安全", () => {
    expect(isSafeNextUrl("https://a.com/x", "https://a.com", "")).toBe(true);
  });
  it("跨源拒绝（开放重定向防线）", () => {
    expect(isSafeNextUrl("https://evil.com", "https://a.com", "")).toBe(false);
    expect(isSafeNextUrl("//evil.com", "https://a.com", "")).toBe(false);
  });
  it("空值拒绝", () => {
    expect(isSafeNextUrl("", "https://a.com", "")).toBe(false);
    expect(isSafeNextUrl(null, "https://a.com", "")).toBe(false);
  });
  it("javascript: 协议必须拒绝", () => {
    expect(isSafeNextUrl("javascript:alert(1)", "https://a.com", "")).toBe(false);
  });
});

describe("isSsoOriginAllowed / assertSsoOrigin", () => {
  it("白名单内放行", () => {
    expect(isSsoOriginAllowed("https://a.com", ["https://a.com"])).toBe(true);
  });
  it("白名单外拒绝", () => {
    expect(isSsoOriginAllowed("https://evil.com", ["https://a.com"])).toBe(false);
  });
  it("空白名单一律拒绝（fail-closed）", () => {
    expect(isSsoOriginAllowed("https://a.com", [])).toBe(false);
  });
  it("assert 版本：合法返回归一化 origin，非法抛错", () => {
    // 签名是 (requestUrl, allowedOriginsCsv)
    expect(assertSsoOrigin("https://a.com/login", "https://a.com")).toContain("a.com");
    expect(() => assertSsoOrigin("https://evil.com/login", "https://a.com")).toThrow();
  });
});

describe("resolveIssuer：签名 (reqUrl, env, basePath)", () => {
  const env = (o: Record<string, string>) => ({ ORIGIN: "https://req.example.com", ...o }) as never;

  it("显式配置优先于请求地址", () => {
    const r = resolveIssuer(
      "https://req.example.com/oidc/login",
      env({ AUTH_SERVER_URL: "https://auth.example.com" }),
      "",
    );
    expect(r).toContain("auth.example.com");
  });
  it("未配置时按请求地址推导", () => {
    const r = resolveIssuer("https://req.example.com/oidc/login", env({}), "");
    expect(r).toContain("req.example.com");
  });
  it("basePath 被并入", () => {
    const r = resolveIssuer("https://req.example.com/login", env({}), "/tenant");
    expect(r).toContain("/tenant");
  });
  it("请求 host 不在 ORIGIN 白名单 → 抛错（fail-closed）", () => {
    expect(() =>
      resolveIssuer("https://evil.com/login", env({}), ""),
    ).toThrow(/invalid_host/);
  });
  it("空 reqUrl 抛错（不得返回猜测的 issuer）", () => {
    expect(() => resolveIssuer("", env({}), "")).toThrow();
  });
});
