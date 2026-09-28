/**
 * 公共 API 契约测试
 *
 * ## 为什么必须有这个文件
 *
 * 历史实现中 `src/index.ts` **只有** `export * as ns`（命名空间导出），没有任何
 * 具名再导出。因此：
 * - README / README.zh-CN / docs×4 / examples×19 共 32 处
 *   `import { X } from "@nuln/worker-kit"` 全部无法编译（TS2305）
 * - `AGENTS.md` §1.2 自身规定的用法（`import { authPageResponse } from "@nuln/worker-kit"`）
 *   同样编译不过
 * - README 的「Submodules Matrix」表格推荐子路径导入，紧接着的 Quick Start 代码块
 *   却用平铺导入 —— 文档自相矛盾
 *
 * 而这一切长期无人发现，根因是：**67 个测试文件全部用深层相对路径导入
 * （`../src/crypto/index.js`），没有任何一个测试导入包入口**，
 * `src/index.ts` 的覆盖率恒为 0。
 *
 * 本文件补上这道门禁：遍历 `package.json` 的 `exports` map，逐一验证每个子路径
 * 入口可解析，且关键符号可通过**根入口平铺导入**取到。
 */

import { describe, it, expect } from "vitest";
// node:fs 的最小类型声明见 ./node-fs.d.ts（不引入 @types/node，
// 避免污染 Worker 运行时的类型面；也不用类型抑制）
import { readFileSync, existsSync } from "node:fs";

import * as rootEntry from "../../src/index.js";
import { renderAuthPage, authPageResponse } from "../../src/index.js";

// 说明：本项目的 tsconfig 只引入 @cloudflare/workers-types（无 node 类型），
// 因此这里不用 node:path / import.meta.url，改用 vitest 提供的工作目录。
// 不引入 @types/node 是刻意的：避免为了让一个测试而污染 Worker 运行时的类型面。
const ROOT = process.cwd();
const PKG = JSON.parse(readFileSync(`${ROOT}/package.json`, "utf8")) as {
  exports: Record<string, string>;
};

/** 文档与 AGENTS.md 中承诺可用的关键平铺符号。 */
const PROMISED_FLAT_EXPORTS = [
  // UI / 认证页（AGENTS §1.1 / §1.2 的核心契约）
  "renderAuthPage",
  "authPageResponse",
  "renderLoginHtml",
  "renderSetupHtml",
  "resolveUiTheme",
  "safeJsonForScript",
  "sanitizeBasePrefix",
  // 加密
  "hashPassword",
  "verifyPassword",
  "encryptJson",
  "decryptJson",
  "sha256Hex",
  "hmacSha256",
  "safeEqual",
  "timingSafeEqual",
  // 会话 / 鉴权
  "parseCookieValue",
  "formatSessionCookie",
  "AuthSessionDO",
  "hasRole",
  "assertSafeIdentifier",
  // 传输
  "jsonResponse",
  "jsonError",
  "escapeHtml",
  "normalizeBasePath",
  "isSafeNextUrl",
  // 通知 / 存储
  "assertSafePublicUrl",
  "maskChannelConfig",
  "createS3Client",
] as const;

describe("package.json exports map", () => {
  it("每个导出路径的目标文件都真实存在", () => {
    const missing: string[] = [];
    for (const [subpath, target] of Object.entries(PKG.exports)) {
      if (!existsSync(`${ROOT}/${target.replace(/^\.\//, "")}`)) {
        missing.push(`${subpath} -> ${target}`);
      }
    }
    expect(missing, `以下 exports 指向不存在的文件：\n${missing.join("\n")}`).toEqual([]);
  });

  it("根入口 \".\" 指向 src/index.ts（供 bundler 直接消费 TS 源码）", () => {
    expect(PKG.exports["."]).toBe("./src/index.ts");
  });
});

describe("根入口平铺导入（文档承诺的用法）", () => {
  it.each(PROMISED_FLAT_EXPORTS)("导出 %s", (name) => {
    expect(
      name in rootEntry,
      `@nuln/worker-kit 未平铺导出 "${name}"。` +
        `文档（README / docs / examples / AGENTS §1.2）均以 from "@nuln/worker-kit" 的方式引用它。`,
    ).toBe(true);
  });

  it("renderAuthPage / authPageResponse 是可调用的函数", () => {
    expect(typeof renderAuthPage).toBe("function");
    expect(typeof authPageResponse).toBe("function");
  });

  it("命名空间导出同时可用（向后兼容）", () => {
    const ns = rootEntry as unknown as Record<string, unknown>;
    for (const name of ["sso", "ui", "crypto", "session", "http", "s3", "sync"]) {
      expect(typeof ns[name], `命名空间导出 ${name} 缺失`).toBe("object");
    }
  });
});

describe("同名符号不得有分叉实现", () => {
  /**
   * 历史上以下符号在两个模块各有一份实现，导致根 barrel 平铺导出冲突，
   * 或调用方导"错"那一份而行为与预期不符：
   *
   * | 符号 | 重复位置 | 权威实现 |
   * |---|---|---|
   * | `resolveIssuer` / `normalizeOrigin` / `isSafeNextUrl` / `assertSsoOrigin` 等 14 个 | `sso` 与 `urls` | `urls/origin` |
   * | `normalizeBasePath` | `http` 与 `basepath` | `basepath` |
   * | `sha256Hex` | `crypto` 与 `s3/sigv4` | `crypto` |
   * | `isLocalhost` | `ui/auth-pages` 与 `webauthn`（签名还不同） | 分别保留，已改名消歧 |
   *
   * 本组用例用**行为等价**而非函数引用相等来锁定收敛。
   *
   * 为什么不用 `expect(a).toBe(b)`：测试运行器（vite/vitest）对同一文件按不同
   * specifier 动态导入时会产出不同的模块实例，函数引用天然不相等 —— 实测
   * `origin.resolveIssuer === sso.resolveIssuer` 为 false，而两者源码上确实是
   * 同一处定义。行为断言不受该工具行为影响，且更贴近真正要保证的东西。
   */
  it("sso 与 urls 的共享原语行为完全一致", async () => {
    const ssoMod = await import("../../src/sso/index.js");
    const urlsMod = await import("../../src/urls/index.js");

    const cases: Array<[string, (m: any) => unknown]> = [
      ["normalizeOrigin", (m) => m.normalizeOrigin("https://a.com/")],
      ["normalizeOrigin(带 userinfo)", (m) => m.normalizeOrigin("https://a.com@evil.com")],
      ["normalizeIssuerUrl", (m) => m.normalizeIssuerUrl("https://a.com/x")],
      ["normalizeSubPath", (m) => m.normalizeSubPath("/tower/")],
      ["parseOriginAllowlist", (m) => m.parseOriginAllowlist("https://a.com,https://b.com")],
      ["resolveIssuer", (m) => m.resolveIssuer("https://x.com/oidc/login", { ORIGIN: "https://x.com" }, "/oidc")],
      ["selectRpId", (m) => m.selectRpId("a.nuln.net", "nuln.net")],
      ["isLoopbackHostname", (m) => m.isLoopbackHostname("10.1.2.3")],
      ["isSafeNextUrl(站内)", (m) => m.isSafeNextUrl("/tower/x", "https://x.com", "/tower")],
      ["isSafeNextUrl(站外)", (m) => m.isSafeNextUrl("https://evil.com", "https://x.com", "/tower")],
      ["isSafeNextUrl(协议相对)", (m) => m.isSafeNextUrl("//evil.com", "https://x.com", "/tower")],
      ["assertSsoOrigin(白名单内)", (m) => m.assertSsoOrigin("https://a.com/x", "https://a.com")],
      ["assertSsoOrigin(已配置白名单+内网)", (m) => m.assertSsoOrigin("https://10.1.2.3/x", "https://a.com")],
    ];

    for (const [label, fn] of cases) {
      const run = (m: any) => {
        try {
          return { ok: fn(m) };
        } catch (e) {
          return { err: e instanceof Error ? e.message : String(e) };
        }
      };
      expect(run(ssoMod), `sso.${label}`).toEqual(run(urlsMod));
    }
  });

  it("http.normalizeBasePath 与 basepath.normalizeBasePath 行为一致", async () => {
    const httpMod = await import("../../src/http/index.js");
    const basepathMod = await import("../../src/basepath/index.js");
    for (const input of [undefined, null, "", "/", "/tower", "tower", "/tower/", "//tower//"]) {
      expect(httpMod.normalizeBasePath(input), `input=${String(input)}`).toBe(
        basepathMod.normalizeBasePath(input),
      );
    }
  });

  it("s3/sigv4.sha256Hex 与 crypto.sha256Hex 输出一致", async () => {
    const sigv4 = await import("../../src/s3/sigv4.js");
    const cryptoMod = await import("../../src/crypto/index.js");
    for (const input of ["", "abc", "报告.pdf"]) {
      expect(await sigv4.sha256Hex(input), `input=${input}`).toBe(
        await cryptoMod.sha256Hex(input),
      );
    }
  });
});
