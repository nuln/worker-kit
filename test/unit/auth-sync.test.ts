import { describe, it, expect } from "vitest";
import { AUTH_SYNC_CHANNEL, AUTH_SYNC_SCRIPT } from "../../src/ui/auth-sync.js";

describe("Auth Sync Module", () => {
  it("defines standard channel", () => {
    expect(AUTH_SYNC_CHANNEL).toBe("nuln_auth_sync");
  });

  it("脚本包含 BroadcastChannel 与 localStorage 双通道", () => {
    const script = AUTH_SYNC_SCRIPT("");
    expect(script).toContain("BroadcastChannel");
    expect(script).toContain("broadcastAuthEvent");
    expect(script).toContain("__nuln_auth_sync__");
  });

  /**
   * `AUTH_SYNC_SCRIPT` 现为函数，接收 basePath 并注入 `window.BASE_PATH`。
   *
   * 此前它是常量字符串，而 `auth-sync.ts` 读取 `window.__BASE_PATH__` ——
   * 全仓库**没有任何写入方**（唯一的写入方 `basepath.renderBaseInjection` 写的是
   * `window.BASE_PATH`，且认证页从不调用它）。于是跨 tab 登录同步时目标地址恒为
   * 域名根路径：部署在 `https://x/mail` 的服务会跳到 `https://x/`（404，或更糟 —
   * 落到另一个服务的登录页）。
   */
  it("注入 window.BASE_PATH（不再读取无人写入的 __BASE_PATH__）", () => {
    const script = AUTH_SYNC_SCRIPT("/mail");
    expect(script).toContain("window.BASE_PATH =");
    expect(script).toContain("/mail");
    expect(script, "不得再读取 __BASE_PATH__").not.toContain("__BASE_PATH__");
  });

  it("basePath 为空时回落为 '/'，不产生 undefined 拼接", () => {
    const script = AUTH_SYNC_SCRIPT("");
    expect(script).toContain("window.BASE_PATH =");
    expect(script).toContain("origin + (window.BASE_PATH || '/')");
  });

  it("basePath 经 safeJsonForScript 转义，不得闭合脚本块", () => {
    const script = AUTH_SYNC_SCRIPT('/bark"></script><script>window.__pwned=1</script>');
    expect(script).not.toContain("<script>window.__pwned=1</script>");
  });
});
