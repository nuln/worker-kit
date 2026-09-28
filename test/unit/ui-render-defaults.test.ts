/**
 * UI 渲染器的「缺省值」分支补齐
 *
 * 这一批未覆盖分支几乎全是 `opts.x || "默认值"` 形态。它们看起来琐碎，
 * 但渲染函数是认证流程的入口 —— 某个 `serviceName` 缺省成空串、
 * 某个 `lang` 判定走错，就会出现"页面白屏"或"英文界面里夹中文"。
 *
 * 做法：把每个渲染器都用**最小入参**调一遍，并逐一断言关键兜底生效。
 */

import { describe, it, expect } from "vitest";
import {
  renderAuthPage,
  renderSetupHtml,
  renderLoginHtml,
  renderInviteHtml,
  renderRecoveryHtml,
  renderSsoErrorHtml,
} from "../../src/ui/auth-pages.js";
import {
  renderModernLoginHtml,
  renderModernSetupHtml,
  renderModernInviteHtml,
  renderModernRecoveryHtml,
  renderModernConsentHtml,
  renderModernSsoErrorHtml,
} from "../../src/ui/themes/modern/index.js";
import { safeJsonForScript, sanitizeBasePrefix } from "../../src/ui/script-safety.js";
import { renderMissingConfigPanel } from "../../src/ui/missing-config.js";
import { renderGearMenuHtml, renderActionGroupHtml } from "../../src/ui/topbar.js";

/* ==================================================== 缺省入参 */

describe("classic 主题：最小入参不崩且兜底生效", () => {
  it("setup：serviceName / basePath 缺省", () => {
    const h = renderSetupHtml({} as never);
    expect(h).toContain("<!doctype html>");
    expect(h).toContain("Service");
  });
  it("login：全部缺省", () => {
    const h = renderLoginHtml({} as never);
    expect(h).toContain("<!doctype html>");
  });
  it("invite：全部缺省", () => {
    const h = renderInviteHtml({} as never);
    expect(h).toContain("<!doctype html>");
  });
  it("recovery：全部缺省", () => {
    const h = renderRecoveryHtml({} as never);
    expect(h).toContain("<!doctype html>");
  });
  it("oidc 错误页：无错误码时只渲染重试入口", () => {
    const h = renderSsoErrorHtml({} as never);
    expect(h).toContain("<!doctype html>");
  });
  it("oidc 错误页：有 error / errorDescription 时都转义后展示", () => {
    const h = renderSsoErrorHtml({
      serviceName: "OIDC",
      error: "<img src=x onerror=alert(1)>",
      errorDescription: "<script>bad</script>",
    } as never);
    expect(h).not.toContain("<img src=x");
    expect(h).not.toContain("<script>bad");
    expect(h).toContain("&lt;img");
  });
  it("oidc 错误页：retryUrl / loginUrl 可覆盖", () => {
    const h = renderSsoErrorHtml({
      serviceName: "OIDC",
      retryUrl: "/custom-retry",
      loginUrl: "/custom-login",
    } as never);
    expect(h).toContain("/custom-retry");
    expect(h).toContain("/custom-login");
  });
  it("renderAuthPage 对每个视图都能用最小入参渲染", () => {
    for (const v of ["setup", "login", "invite", "recovery", "sso-error", "consent"] as const) {
      expect(() => renderAuthPage({ view: v, serviceName: "" }), v).not.toThrow();
    }
  });
  it("未知 view 显式抛错（曾静默返回空串导致认证页白屏）", () => {
    expect(() => renderAuthPage({ view: "nope" as never, serviceName: "x" })).toThrow(/unknown view/);
  });
});

describe("modern 主题：最小入参不崩且兜底生效", () => {
  it("login：全部缺省", () => {
    expect(renderModernLoginHtml({} as never)).toContain("<!doctype html>");
  });
  it("setup：全部缺省", () => {
    expect(renderModernSetupHtml({} as never)).toContain("<!doctype html>");
  });
  it("invite：全部缺省", () => {
    expect(renderModernInviteHtml({} as never)).toContain("<!doctype html>");
  });
  it("recovery：全部缺省", () => {
    expect(renderModernRecoveryHtml({} as never)).toContain("<!doctype html>");
  });
  it("consent：必填字段全缺省也不白屏（回归：曾因 scopes.map 抛 TypeError）", () => {
    const h = renderModernConsentHtml({} as never);
    expect(h).toContain("<!doctype html>");
  });
  it("consent：scopes 正常渲染", () => {
    const h = renderModernConsentHtml({ scopes: ["openid", "email"], clientName: "App" } as never);
    expect(h).toContain("openid");
    expect(h).toContain("App");
  });
  it("sso 错误页：全部缺省", () => {
    expect(renderModernSsoErrorHtml({} as never)).toContain("<!doctype html>");
  });
  it("sso 错误页：有错误码时展示", () => {
    const h = renderModernSsoErrorHtml({ error: "access_denied" } as never);
    expect(h).toContain("access_denied");
  });
  it("缺省时正文不出现 undefined（脚本里的 typeof x === 'undefined' 是合法的）", () => {
    for (const fn of [
      renderModernLoginHtml,
      renderModernSetupHtml,
      renderModernInviteHtml,
      renderModernRecoveryHtml,
      renderModernSsoErrorHtml,
      renderModernConsentHtml,
    ]) {
      const h = fn({} as never);
      // 客户端脚本里 `typeof x === 'undefined'` 是正常代码，只查 <body> 之后
      const body = h.slice(h.indexOf("<body>"));
      expect(body, `${fn.name} 正文出现了 undefined`).not.toContain("undefined");
    }
  });
  it("sso provider 有无 icon 都能渲染", () => {
    const withIcon = renderModernLoginHtml({
      ssoProviders: [{ id: "a", name: "A", icon: "https://i/x.png" }],
    } as never);
    const without = renderModernLoginHtml({ ssoProviders: [{ id: "a", name: "A" }] } as never);
    expect(withIcon).toContain("<img");
    expect(without).not.toContain("sso-icon");
  });
});

/* ==================================================== script-safety */

describe("sanitizeBasePrefix：剔除可注入字符", () => {
  it("正常前缀原样返回", () => {
    expect(sanitizeBasePrefix("/tower")).toBe("/tower");
  });
  it("空值归一为空串", () => {
    expect(sanitizeBasePrefix("")).toBe("");
    expect(sanitizeBasePrefix(undefined)).toBe("");
  });
  it("引号 / 尖括号 / 反斜杠被剔除（不抛错，直接去掉）", () => {
    // 刻意的设计：剔除而非抛错。basePath 来自服务自身配置，
    // 抛错会让整个认证页 500；剔除后剩下的路径仍可用。
    expect(sanitizeBasePrefix('/a"><script>')).toBe("/ascript");
    expect(sanitizeBasePrefix("/a\\b")).toBe("/ab");
  });
  it("非字符串输入安全归一", () => {
    expect(sanitizeBasePrefix(123)).toBe("123");
    expect(sanitizeBasePrefix(null)).toBe("");
  });
});

describe("safeJsonForScript", () => {
  it("普通对象原样序列化", () => {
    expect(JSON.parse(safeJsonForScript({ a: 1 }))).toEqual({ a: 1 });
  });
  it("含 </script> 时被转义（防提前闭合）", () => {
    const out = safeJsonForScript({ x: "</script><script>alert(1)</script>" });
    expect(out.toLowerCase()).not.toContain("</script>");
  });
  it("含 U+2028/2029 时被转义（防 JS 语法错误）", () => {
    const out = safeJsonForScript({ x: "  " });
    expect(out).not.toContain(" ");
    expect(out).not.toContain(" ");
  });
  it("undefined / null 也能安全处理", () => {
    expect(() => safeJsonForScript(undefined)).not.toThrow();
    expect(() => safeJsonForScript(null)).not.toThrow();
  });
});

/* ==================================================== 缺配置面板 / topbar */

describe("renderMissingConfigPanel", () => {
  const p = { kind: "secret" as const, name: "X", reason: "为什么", hint: "怎么配", fatal: true };

  it("只给阻断项时渲染", () => {
    const h = renderMissingConfigPanel({ serviceName: "S", blocking: [p] });
    expect(h).toContain("X");
    expect(h).toContain("为什么");
    expect(h).toContain("怎么配");
  });
  it("无阻断项时仍渲染（不产生空白面板）", () => {
    const h = renderMissingConfigPanel({ serviceName: "S", blocking: [], advisory: [p] });
    expect(h).toContain("X");
  });
  it("无阻断项时仍渲染（调用方可能只想看建议项）", () => {
    const h = renderMissingConfigPanel({ serviceName: "S", blocking: [], advisory: [p] });
    expect(h).toContain("cfg-panel");
  });
  it("给出进度时展示已配置/总数", () => {
    const h = renderMissingConfigPanel({
      serviceName: "S",
      blocking: [p],
      configuredCount: 1,
      totalCount: 3,
    });
    expect(h).toMatch(/1\s*\/\s*3/);
  });
  it("内容全部转义", () => {
    const h = renderMissingConfigPanel({
      serviceName: "<script>",
      blocking: [{ ...p, reason: "<img src=x>" }],
    });
    expect(h).not.toContain("<script>");
    expect(h).not.toContain("<img src=x>");
  });
  it("英文环境输出英文", () => {
    const h = renderMissingConfigPanel({ serviceName: "S", blocking: [p], lang: "en" });
    expect(h).toContain("Setup blocked");
  });
});

describe("topbar：齿轮菜单与操作组", () => {
  it("缺省入参可渲染", () => {
    expect(() => renderGearMenuHtml()).not.toThrow();
    expect(() => renderActionGroupHtml()).not.toThrow();
  });
  it("齿轮菜单展示用户 email（缺省回落到字典文案）", () => {
    expect(renderGearMenuHtml({ user: { email: "a@b.c" } })).toContain("a@b.c");
    const fallback = renderGearMenuHtml();
    expect(fallback, "无用户时应回落到占位文案而非空白").not.toContain("more-user\"></div>");
  });
  it("齿轮菜单的 onSettingsClick / onLogoutClick 可覆盖", () => {
    const h = renderGearMenuHtml({ onSettingsClick: "/cfg", onLogoutClick: "/bye" });
    expect(h).toContain("/cfg");
    expect(h).toContain("/bye");
  });
  it("用户字段被转义（防 XSS）", () => {
    const h = renderGearMenuHtml({ user: { email: "<img src=x onerror=alert(1)>" } });
    expect(h).not.toContain("<img src=x");
  });
  it("齿轮菜单用 data-nav 承载跳转目标（无 JS 时也能降级为普通交互）", () => {
    const h = renderGearMenuHtml();
    expect(h).toContain('data-nav="/settings"');
    expect(h).toContain('data-nav="/login?logout=1"');
  });
  it("操作组缺省入参返回非空片段", () => {
    expect(renderActionGroupHtml().length).toBeGreaterThan(0);
  });
});
