/**
 * 部署预检模块（@nuln/worker-kit/config）测试
 *
 * ## 要锁定的核心行为
 *
 * 预检的价值在于**让配置缺陷在请求到达用户之前暴露**。因此判定必须：
 * - 缺项 / 空串 / 空白串 → 一律算缺失
 * - 致命问题 → 抛 `ConfigError`（会冒泡到 Worker 入口并触发平台告警）
 * - 错误信息**绝不含密钥值**（否则日志与响应都会泄密）
 * - 状态码用 503（依赖不可用）而非 500（代码崩了）
 */

import { describe, it, expect } from "vitest";
import {
  inspect,
  assertConfigured,
  preflight,
  toConfigError,
  configErrorResponse,
  preflightGuard,
  ConfigError,
} from "../../src/config/index.js";

const SPEC = {
  AUTH_SESSION_DO_SECRET: "会话 DO 的 HTTP 入口鉴权",
  ORIGIN: { why: "WebAuthn origin 锚点" },
};

describe("inspect：判定缺失", () => {
  it("全部就绪时 ok=true", () => {
    const r = inspect({ AUTH_SESSION_DO_SECRET: "s", ORIGIN: "https://a.com" }, SPEC, "secret");
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it("undefined / null / 空串 / 空白串 一律算缺失", () => {
    for (const v of [undefined, null, "", "   ", "\n\t "]) {
      const r = inspect({ AUTH_SESSION_DO_SECRET: v }, SPEC, "secret");
      expect(r.ok, `值 ${JSON.stringify(v)} 应判为缺失`).toBe(false);
      expect(r.problems[0].name).toBe("AUTH_SESSION_DO_SECRET");
    }
  });

  it("非字符串值（如绑定对象）视为存在", () => {
    const r = inspect(
      { AUTH_SESSION_DO_SECRET: { idFromName: () => "x" }, ORIGIN: "https://a.com" },
      SPEC,
      "secret",
    );
    expect(r.ok).toBe(true);
  });

  it("缺失项带原因与修复指引", () => {
    const r = inspect({}, SPEC, "secret");
    expect(r.problems[0].reason).toContain("未注入或为空");
    expect(r.problems[0].hint).toContain("wrangler secret put");
    expect(r.problems[0].kind).toBe("secret");
  });

  it("required:false 的项不阻断", () => {
    const r = inspect(
      {},
      { OPTIONAL: { why: "可选优化", required: false } },
      "var",
    );
    expect(r.ok).toBe(true);
    expect(r.problems).toHaveLength(1);
  });

  it("自定义 check 不通过时判为问题", () => {
    const r = inspect(
      { EMAIL_WEBHOOK_URL: "not-a-url" },
      { EMAIL_WEBHOOK_URL: { why: "发信网关", check: (v) => String(v).startsWith("https://") } },
      "apiKey",
    );
    expect(r.ok).toBe(false);
    expect(r.problems[0].reason).toContain("未通过校验");
  });
});

describe("assertConfigured：fail-closed 抛错", () => {
  it("有缺失即抛 ConfigError，且携带完整清单", () => {
    let caught: unknown;
    try {
      assertConfigured({}, SPEC, "secret", "tower");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    const err = caught as ConfigError;
    expect(err.problems.length).toBe(2);
    expect(err.problems.map((p) => p.name).sort()).toEqual([
      "AUTH_SESSION_DO_SECRET",
      "ORIGIN",
    ]);
    expect(err.message).toContain("tower");
  });

  it("全部就绪时不抛", () => {
    expect(() =>
      assertConfigured({ AUTH_SESSION_DO_SECRET: "s", ORIGIN: "https://a.com" }, SPEC, "secret"),
    ).not.toThrow();
  });

  it("错误信息绝不含已注入的密钥值", () => {
    const secret = "super-secret-value-do-not-log";
    let msg = "";
    try {
      assertConfigured({ AUTH_SESSION_DO_SECRET: secret, ORIGIN: "" }, SPEC, "secret");
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).not.toContain(secret);
  });
});

describe("preflight：多组汇总", () => {
  it("汇总 secrets / bindings / vars / apiKeys 四组", () => {
    const report = preflight(
      { ORIGIN: "https://a.com" },
      {
        secrets: { COOKIE_SECRET: "会话签名密钥" },
        bindings: { DB: "D1Database" },
        vars: { ORIGIN: "origin" },
        apiKeys: { RESEND_API_KEY: "发信" },
      },
      "tower",
    );
    expect(report.ok).toBe(false);
    const names = report.problems.map((p) => p.name).sort();
    expect(names).toEqual(["COOKIE_SECRET", "DB", "RESEND_API_KEY"]);
    expect(report.summary).toContain("tower");
    expect(report.summary).toContain("COOKIE_SECRET");
  });

  it("全部就绪时 ok=true", () => {
    const report = preflight(
      { COOKIE_SECRET: "s", DB: {}, ORIGIN: "https://a.com", RESEND_API_KEY: "k" },
      {
        secrets: { COOKIE_SECRET: "x" },
        bindings: { DB: "x" },
        vars: { ORIGIN: "x" },
        apiKeys: { RESEND_API_KEY: "x" },
      },
    );
    expect(report.ok).toBe(true);
  });

  it("toConfigError 在 ok 时返回 null", () => {
    const ok = preflight({}, { secrets: {} });
    expect(toConfigError(ok)).toBeNull();
    const bad = preflight({}, { secrets: { X: "x" } });
    expect(toConfigError(bad)).toBeInstanceOf(ConfigError);
  });
});

describe("configErrorResponse：转 503 且遵守统一响应契约", () => {
  it("ConfigError → 503 + 统一契约 + 缺失清单", async () => {
    const err = new ConfigError(
      [
        {
          kind: "binding",
          name: "RATE_LIMITER_DO",
          reason: "未绑定 —— 限流无法工作",
          hint: "在 wrangler.jsonc 声明 DurableObject 绑定",
          fatal: true,
        },
      ],
      "tower",
    );
    const res = configErrorResponse(err);
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      ok: boolean;
      error: string;
      code: string;
      details: Array<{ kind: string; name: string; reason: string; hint: string }>;
    };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("service_not_configured");
    expect(body.code).toBe("CONFIG_MISSING");
    expect(body.details[0].name).toBe("RATE_LIMITER_DO");
    expect(body.details[0].hint).toBeTruthy();
  });

  it("非 ConfigError → 500，不泄露内部细节", async () => {
    const res = configErrorResponse(new Error("secret internal detail"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("secret internal detail");
  });

  it("响应带 cache-control: no-store（配置错误不应被缓存）", () => {
    const res = configErrorResponse(new ConfigError([], "x"));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("preflightGuard：便捷版", () => {
  it("有致命问题直接返回 503", async () => {
    const res = preflightGuard({}, { secrets: { X: "x" } }, "svc");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
  });

  it("无问题时返回 null（放行）", () => {
    expect(preflightGuard({ X: "set" }, { secrets: { X: "x" } }, "svc")).toBeNull();
  });
});
