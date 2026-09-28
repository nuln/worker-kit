/**
 * SSO Origin 白名单回归测试。
 *
 * 锁定一条容易被"顺手改回去"的行为：**回环/内网豁免只在未配置白名单时生效**。
 *
 * 历史实现把 `isLoopbackHostname` 检查放在白名单判定之前且无条件 `return`，
 * 与函数自身的文档承诺（"未配置白名单时，回环地址自动放行"）相反。后果是：
 * 即使生产已配置严格白名单，`Host: localhost` 或任一 RFC1918 私网地址
 * 仍能通过信任检查，而 `resolveOidcRedirectUri` / `resolveOidcIssuer`
 * 都以本函数为闸门 → OIDC issuer/redirect_uri 可从伪造主机推导。
 */

import { describe, it, expect } from "vitest";
import { assertSsoOrigin } from "../../src/sso/index.js";

const STRICT = "https://tower.dukangxu.com";

describe("assertSsoOrigin：已配置白名单时不得有回环/内网豁免", () => {
  it("白名单内的来源放行", () => {
    expect(assertSsoOrigin("https://tower.dukangxu.com/oidc/login", STRICT)).toBe(STRICT);
  });

  it("白名单外的公网来源拒绝", () => {
    expect(() => assertSsoOrigin("https://evil.com/x", STRICT)).toThrow(/invalid_sso_host/);
  });

  it.each([
    ["localhost", "http://localhost:8788/tower"],
    ["127.0.0.1", "http://127.0.0.1:8788/tower"],
    ["10/8 私网", "https://10.1.2.3/tower"],
    ["192.168/16 私网", "https://192.168.0.9/"],
    ["172.16/12 私网", "https://172.20.0.1/"],
  ])("%s 在已配置白名单时必须被拒绝", (_label, url) => {
    expect(() => assertSsoOrigin(url, STRICT)).toThrow(/invalid_sso_host/);
  });
});

describe("assertSsoOrigin：未配置白名单时的开发便利", () => {
  it.each([
    ["localhost", "http://localhost:8788/tower"],
    ["10/8 私网", "https://10.1.2.3/tower"],
  ])("%s 放行（本地联调零配置）", (_label, url) => {
    expect(() => assertSsoOrigin(url, undefined)).not.toThrow();
  });

  it("外部来源 fail-closed（missing_config）", () => {
    expect(() => assertSsoOrigin("https://evil.com/x", undefined)).toThrow(/missing_config/);
  });
});

describe("assertSsoOrigin：通配符", () => {
  it('"*" 放行任意来源（显式配置，不受豁免逻辑影响）', () => {
    expect(assertSsoOrigin("https://anything.example/x", "*")).toBe("https://anything.example");
  });
});
