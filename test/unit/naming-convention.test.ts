/**
 * 校验类 API 命名规范门禁
 *
 * 规范定义见 `@nuln/worker-kit/conventions`：
 * - `assertXxx()`  失败**抛错**
 * - `isXxx()`      失败**返回布尔**，永不抛错
 * - 配对版本必须**镜像命名**
 *
 * ## 为什么必须有门禁
 *
 * 历史上同一个概念有三套前缀（`assert*` / `is*` / `validate*`），并出现过
 * **同名不同签名**的实例：`sso` 的 `assertSsoOrigin(url, csv) => string`（抛错）
 * 与 `urls` 的 `assertSsoOrigin(origin, allowlist[]) => boolean`（不抛）。
 * 调用方按其中一种签名编写、编译到另一种上，行为完全错位且**编译器不报错**。
 *
 * 命名一旦发散就没有机制会发现，只能靠人 review —— 所以这里自动校验。
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { isConventionalValidationName, SSO_ORIGIN_BOOL_NAME } from "../../src/conventions.js";
import { assertSsoOrigin, isSsoOriginAllowed } from "../../src/urls/origin.js";
import { assertSafeIdentifier, isSafeIdentifier } from "../../src/db/identifier.js";

const SRC = process.cwd() + "/src";

function collect(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = `${dir}/${e}`;
    if (e === "node_modules") continue;
    if (statSync(full).isDirectory()) collect(full, out);
    else if (e.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("命名规范：assert* 抛错 / is* 返回布尔", () => {
  it("src/ 下不存在 validate* / check* / require* 前缀的导出", () => {
    const offenders: string[] = [];
    for (const file of collect(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(
        /export (?:async )?function ((?:validate|check|require)[A-Za-z0-9_]+)\s*\(/g,
      )) {
        offenders.push(`${file.replace(SRC, "src")}: ${m[1]}`);
      }
    }
    expect(
      offenders,
      `这些导出使用了被废弃的前缀（应为 assert* 抛错或 is* 返回布尔）：\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("isConventionalValidationName 的判定与规范一致", () => {
    for (const ok of [
      "assertSsoOrigin",
      "assertSafeIdentifier",
      "isSsoOriginAllowed",
      "isSafeIdentifier",
      "renderAuthPage",
      "resolveIssuer",
    ]) {
      expect(isConventionalValidationName(ok), `${ok} 应合规`).toBe(true);
    }
    for (const bad of [
      "validateRedirectUri",
      "checkBaselineExistsOnS3",
      "requireEnv",
    ]) {
      expect(isConventionalValidationName(bad), `${bad} 应不合规`).toBe(false);
    }
  });
});

describe("抛错版与布尔版必须镜像命名", () => {
  it("SSO Origin：assertSsoOrigin ⇄ isSsoOriginAllowed", () => {
    expect(SSO_ORIGIN_BOOL_NAME).toBe("isSsoOriginAllowed");
    expect(typeof assertSsoOrigin).toBe("function");
    expect(typeof isSsoOriginAllowed).toBe("function");
  });

  it("SQL 标识符：assertSafeIdentifier ⇄ isSafeIdentifier", () => {
    expect(typeof assertSafeIdentifier).toBe("function");
    expect(typeof isSafeIdentifier).toBe("function");
    // 两者对同一输入的结论必须一致
    const cases: Array<[string, boolean]> = [
      ["users", true],
      ['users" WHERE 1=1 --', false],
      ["1abc", false],
      ["", false],
    ];
    for (const [input, expected] of cases) {
      let threw = false;
      try {
        assertSafeIdentifier(input);
      } catch {
        threw = true;
      }
      expect(threw, `assert 对 ${JSON.stringify(input)} 的抛错行为`).toBe(!expected);
      expect(isSafeIdentifier(input), `is 对 ${JSON.stringify(input)} 的结论`).toBe(expected);
    }
  });
});

describe("两种失败模式行为一致（只是表现不同）", () => {
  it("SSO Origin：通过白名单时两者都通过", () => {
    const origin = "https://tower.dukangxu.com";
    expect(() => assertSsoOrigin("https://tower.dukangxu.com/x", origin)).not.toThrow();
    expect(isSsoOriginAllowed(origin, [origin])).toBe(true);
  });

  it("SSO Origin：不在白名单时前者抛错、后者返回 false", () => {
    expect(() => assertSsoOrigin("https://evil.com/x", "https://tower.dukangxu.com")).toThrow();
    expect(isSsoOriginAllowed("https://evil.com", ["https://tower.dukangxu.com"])).toBe(false);
  });

  it("两个模块的共享实现仍是同一个函数对象（未因改名产生分叉）", async () => {
    const sso = await import("../../src/sso/index.js");
    const urls = await import("../../src/urls/index.js");
    expect(sso.assertSsoOrigin).toBe(urls.assertSsoOrigin);
    expect(sso.isSsoOriginAllowed).toBe(urls.isSsoOriginAllowed);
    expect(sso.isRedirectUriAllowed).toBe(urls.isRedirectUriAllowed);
  });
});

describe("已废弃的旧名不再作为主入口", () => {
  it("isOriginInAllowlist / validateRedirectUri / checkBaselineExistsOnS3 均已不存在", async () => {
    const urls = (await import("../../src/urls/index.js")) as Record<string, unknown>;
    expect(urls.isOriginInAllowlist).toBeUndefined();
    expect(urls.validateRedirectUri).toBeUndefined();
    const s3backup = (await import("../../src/backup/s3-backup.js")) as Record<string, unknown>;
    expect(s3backup.checkBaselineExistsOnS3).toBeUndefined();
  });

  it("新名可用", async () => {
    const urls = (await import("../../src/urls/index.js")) as Record<string, unknown>;
    expect(typeof urls.isSsoOriginAllowed).toBe("function");
    expect(typeof urls.isRedirectUriAllowed).toBe("function");
    const s3backup = (await import("../../src/backup/s3-backup.js")) as Record<string, unknown>;
    expect(typeof s3backup.isBaselinePresentOnS3).toBe("function");
  });
});
