/**
 * 初始化前置检查（Setup Gate）测试
 *
 * ## 需求
 *
 * 打开 `/setup` 时，如果环境变量没配置，页面应**显示需要配置什么**，
 * 而不是继续走初始化 —— 否则用户配完 Passkey 才发现邮件/限流根本没生效。
 *
 * ## 两条硬性要求
 *
 * 1. **不进入初始化流程**：缺配置时页面只渲染清单，不渲染表单与注册脚本
 * 2. **加环境变量不改代码**：需求是纯数据，运行期往数组里追加一项，
 *    页面必须自动反映 —— 这一点由「可扩展性」用例直接验证
 */

import { describe, it, expect } from "vitest";
import { renderAuthPage, authPageResponse } from "../../src/ui/auth-pages.js";
import { renderModernSetupHtml } from "../../src/ui/themes/index.js";
import {
  REQUIREMENTS,
  defineRequirements,
  evaluateRequirements,
  inspectRequirements,
} from "../../src/config/requirements.js";
import { ConfigError } from "../../src/config/index.js";

const REQS = defineRequirements(REQUIREMENTS.passkey, REQUIREMENTS.session);
const FULL_ENV = {
  RP_ID: "auth.nuln.net",
  ORIGIN: "https://auth.nuln.net",
  COOKIE_SECRET: "s3cr3t-cookie",
  AUTH_SESSION_DO_SECRET: "s3cr3t-do",
};

/** 面板本体（而非样式表里的类名） */
const panelBody = (html: string) => html.includes('class="cfg-panel" role="alert"');

/**
 * 只数**阻断区**的条目。
 *
 * 面板会同时渲染「必须配置」与「建议配置」两个分区，直接数全部 `cfg-item`
 * 会把 `required:false` 的建议项也算进去，从而看不出阻断项到底有几个。
 */
const countBlockingItems = (html: string): number => {
  // 先去掉 <style> —— 样式表里同样有 .cfg-section-advisory 与 .cfg-item 字样
  const body = html.split("</style>").slice(1).join("</style>");
  const blocking = body.split("cfg-section-advisory")[0] ?? body;
  return (blocking.match(/class="cfg-item"/g) ?? []).length;
};
const formBody = (html: string) => html.includes('id="setup-btn"');

describe("evaluateRequirements：判定与展示", () => {
  it("空环境 → 全部列为阻断项", () => {
    const r = evaluateRequirements({}, REQS);
    expect(r.ok).toBe(false);
    expect(r.blocking.map((p) => p.name)).toEqual([
      "RP_ID",
      "ORIGIN",
      "COOKIE_SECRET",
      "AUTH_SESSION_DO_SECRET",
    ]);
  });

  it("每项都带「为什么」与「怎么配」", () => {
    const r = evaluateRequirements({}, REQS);
    for (const p of r.blocking) {
      expect(p.reason.length, `${p.name} 缺少原因`).toBeGreaterThan(0);
      expect(p.hint.length, `${p.name} 缺少修复指引`).toBeGreaterThan(0);
    }
    // secret 类应给出 wrangler secret put 命令
    const cookie = r.blocking.find((p) => p.name === "COOKIE_SECRET")!;
    expect(cookie.hint).toContain("wrangler secret put COOKIE_SECRET");
  });

  it("空白串视为未配置", () => {
    const r = evaluateRequirements({ ...FULL_ENV, RP_ID: "   " }, REQS);
    expect(r.ok).toBe(false);
    expect(r.blocking[0].name).toBe("RP_ID");
  });

  it("配置齐备 → ok", () => {
    expect(evaluateRequirements(FULL_ENV, REQS).ok).toBe(true);
  });

  it("required:false 的项不阻断，但进 advisory", () => {
    const reqs = defineRequirements({
      name: "ADMIN_EMAIL",
      kind: "var",
      why: "初始管理员邮箱",
      required: false,
    });
    const r = evaluateRequirements({}, reqs);
    expect(r.ok).toBe(true);
    expect(r.advisory.map((p) => p.name)).toEqual(["ADMIN_EMAIL"]);
  });

  it("自定义 check 不通过也算缺失", () => {
    const reqs = defineRequirements({
      name: "URL",
      kind: "var",
      why: "回调地址",
      check: (v: unknown) => String(v).startsWith("https://"),
    });
    expect(evaluateRequirements({ URL: "http://x" }, reqs).ok).toBe(false);
    expect(evaluateRequirements({ URL: "https://x" }, reqs).ok).toBe(true);
  });

  it("inspectRequirements 与 evaluateRequirements 判定一致（页面显示什么，API 就拦什么）", () => {
    for (const env of [{}, { RP_ID: "a" }, FULL_ENV]) {
      const a = evaluateRequirements(env, REQS).ok;
      const b = inspectRequirements(env, REQS).ok;
      expect(b, `env=${JSON.stringify(env).slice(0, 30)} 判定应一致`).toBe(a);
    }
  });

  it("inspectRequirements 逐字段等于 evaluateRequirements（kind / hint 都不得走样）", () => {
    // 曾把 inspectRequirements 写成 inspect(env, spec, "var") —— 而 kind 是整份报告
    // 共享的单值，于是 secret 会被报成环境变量、hint 变成"去 .dev.vars 配"，
    // 而它本该用 `wrangler secret put`。页面与 API 因此给出互相矛盾的意见，
    // 且错误信息会把人引向错误的修复动作。
    const wide = defineRequirements(
      REQUIREMENTS.passkey,
      REQUIREMENTS.session,
      REQUIREMENTS.database,
      REQUIREMENTS.mail,
    );
    const key = (p: { kind: string; name: string; reason: string; hint: string; fatal: boolean }) =>
      `${p.kind}|${p.name}|${p.reason}|${p.hint}|${p.fatal}`;
    expect(inspectRequirements({}, wide).problems.map(key).sort()).toEqual(
      evaluateRequirements({}, wide).all.map(key).sort(),
    );
  });

  it("503 里的 kind 与修复指令必须正确（secret 要用 wrangler secret put）", () => {
    const r = inspectRequirements({}, defineRequirements(REQUIREMENTS.session, REQUIREMENTS.database));
    const byName = new Map(r.problems.map((p) => [p.name, p]));
    expect(byName.get("COOKIE_SECRET")?.kind).toBe("secret");
    expect(byName.get("COOKIE_SECRET")?.hint).toContain("wrangler secret put COOKIE_SECRET");
    expect(byName.get("DB")?.kind).toBe("binding");
    expect(byName.get("DB")?.hint).toContain("wrangler.jsonc");
  });
});

describe("classic setup 页：缺配置时不进入初始化", () => {
  const render = (env: unknown, requirements = REQS, lang = "zh") =>
    renderAuthPage({
      view: "setup",
      serviceName: "Tower",
      basePath: "/tower",
      env: env as Record<string, unknown>,
      requirements,
      lang,
    });

  it("缺配置 → 显示清单，不显示表单", () => {
    const html = render({});
    expect(panelBody(html)).toBe(true);
    expect(formBody(html)).toBe(false);
  });

  it("清单逐项列出缺失变量名", () => {
    const html = render({});
    for (const name of ["RP_ID", "ORIGIN", "COOKIE_SECRET", "AUTH_SESSION_DO_SECRET"]) {
      expect(html, `应列出 ${name}`).toContain(name);
    }
  });

  it("给出可执行的修复命令", () => {
    const html = render({});
    expect(html).toContain("wrangler secret put COOKIE_SECRET");
  });

  it("被阻止时不注入注册脚本（避免无意义的 Passkey 注册）", () => {
    const html = render({});
    expect(html).not.toContain("loginPasskey");
    expect(html).not.toContain("setupPasskey");
  });

  it("配置齐备 → 显示表单，不显示清单", () => {
    const html = render(FULL_ENV);
    expect(formBody(html)).toBe(true);
    expect(panelBody(html)).toBe(false);
  });

  it("部分配置 → 仍阻断，但只列真正缺的那几项", () => {
    const html = render({ RP_ID: "a.com", ORIGIN: "https://a.com" });
    expect(panelBody(html)).toBe(true);
    expect(html).toContain("COOKIE_SECRET");
    expect(html).not.toContain("RP_ID<"); // RP_ID 已配置，不应再出现在清单里
  });

  it("不传 requirements 时行为不变（向后兼容）", () => {
    const html = renderAuthPage({ view: "setup", serviceName: "Tower", basePath: "/tower" });
    expect(formBody(html)).toBe(true);
    expect(panelBody(html)).toBe(false);
  });

  it("英文环境显示英文清单", () => {
    const html = render({}, REQS, "en");
    expect(html).toContain("Setup blocked");
    expect(html).toContain("Required");
  });

  it("清单内容已转义（why/hint 中的尖括号不会逃逸）", () => {
    const reqs = defineRequirements({
      name: "EVIL",
      kind: "var",
      why: '<img src=x onerror=alert(1)>',
      hint: '<script>bad</script>',
    });
    const html = render({}, reqs);
    expect(html).not.toContain("<img src=x onerror");
    expect(html).toContain("&lt;img");
  });
});

describe("modern 主题：与 classic 行为一致", () => {
  const render = (env: unknown) =>
    renderModernSetupHtml({
      serviceName: "Tower",
      basePath: "/tower",
      env: env as Record<string, unknown>,
      requirements: REQS,
      lang: "zh",
    });

  it("缺配置 → 显示清单", () => {
    const html = render({});
    expect(html).toContain('class="cfg-panel" role="alert"');
    expect(html).toContain("AUTH_SESSION_DO_SECRET");
  });

  it("配置齐备 → 显示表单", () => {
    const html = render(FULL_ENV);
    expect(html).toContain('id="setup-btn"');
    expect(html).not.toContain('class="cfg-panel" role="alert"');
  });
});

describe("可扩展性：加环境变量不改代码（核心约束）", () => {
  it("运行期往数组追加一项，页面自动纳入判定", () => {
    // 这是本需求的硬性要求：新增环境变量只能改数据，不能改渲染/校验代码
    const base = defineRequirements(REQUIREMENTS.passkey);
    const before = evaluateRequirements({ RP_ID: "a", ORIGIN: "https://a" }, base);
    expect(before.ok).toBe(true);

    // 业务方新增一项 —— 只加一行数据
    const extended = defineRequirements(base, {
      name: "BRAND_NEW_SECRET",
      kind: "secret",
      why: "新引入的第三方凭据",
    });

    const after = evaluateRequirements({ RP_ID: "a", ORIGIN: "https://a" }, extended);
    expect(after.ok).toBe(false);
    expect(after.blocking.map((p) => p.name)).toEqual(["BRAND_NEW_SECRET"]);

    // 同一份数据，页面无需任何改动即反映
    const html = renderAuthPage({
      view: "setup",
      serviceName: "Tower",
      basePath: "/tower",
      env: { RP_ID: "a", ORIGIN: "https://a" },
      requirements: extended,
      lang: "zh",
    });
    expect(html).toContain("BRAND_NEW_SECRET");
    expect(html).toContain("wrangler secret put BRAND_NEW_SECRET");
    expect(panelBody(html)).toBe(true);
  });

  it("内置预设按能力分组，服务按需组合", () => {
    expect(Object.keys(REQUIREMENTS).length).toBeGreaterThanOrEqual(7);
    for (const [group, items] of Object.entries(REQUIREMENTS)) {
      for (const r of items as ReadonlyArray<{ name: string; why: string; kind: string }>) {
        expect(r.name, `${group} 中的项缺少 name`).toBeTruthy();
        expect(r.why, `${group}.${r.name} 缺少 why`).toBeTruthy();
        expect(["secret", "binding", "var", "apiKey"], `${group}.${r.name} 的 kind 非法`).toContain(r.kind);
      }
    }
  });

  it("defineRequirements 去重且不修改入参数组", () => {
    const input = [{ name: "A", kind: "var" as const, why: "a" }];
    const out = defineRequirements(input, input, { name: "A", kind: "var" as const, why: "b" });
    expect(out).toHaveLength(1);
    expect(out[0].why).toBe("a"); // 保留首次出现的
    expect(input).toHaveLength(1); // 入参未被改动
  });

  it("只声明了 required:false 的项时，页面仍渲染表单", () => {
    const reqs = defineRequirements({
      name: "OPTIONAL",
      kind: "var",
      why: "可选",
      required: false,
    });
    const html = renderAuthPage({
      view: "setup",
      serviceName: "Tower",
      env: {},
      requirements: reqs,
      lang: "zh",
    });
    // 建议项不阻断，因此表单照常渲染
    expect(formBody(html)).toBe(true);
    expect(panelBody(html)).toBe(false);
  });
});

describe("错误信息不含密钥值", () => {
  it("已注入的密钥不出现在任何输出中", () => {
    const secret = "TOP-SECRET-DO-NOT-LEAK";
    const env = { ...FULL_ENV, AUTH_SESSION_DO_SECRET: secret, RP_ID: "" };
    const gate = evaluateRequirements(env, REQS);
    const serialized = JSON.stringify(gate);
    expect(serialized).not.toContain(secret);
    const html = renderAuthPage({
      view: "setup",
      serviceName: "Tower",
      env,
      requirements: REQS,
      lang: "zh",
    });
    expect(html).not.toContain(secret);
  });

  it("inspectRequirements 的结果同样不含值", () => {
    const secret = "leak-me-not";
    const r = inspectRequirements({ AUTH_SESSION_DO_SECRET: secret, RP_ID: "" }, REQS);
    expect(JSON.stringify(r)).not.toContain(secret);
    expect(r.ok).toBe(false);
  });
});

describe("defineRequirements：形态与字段校验（防止静默产出错误结果）", () => {
  it("传入「需求项的集合」（非数组）时显式抛错，而不是当成单项静默处理", () => {
    // 这个形态曾导致 {ADMIN_EMAIL:{kind,why}} 被当成一项 name=ADMIN_EMAIL
    // 而 kind/why 全为 undefined 的需求 —— 静默产出错误结果。
    expect(() =>
      defineRequirements({ ADMIN_EMAIL: { kind: "var", why: "x" } } as never),
    ).toThrowError(/数组或含 name 的单项/);
  });

  it("缺 kind 时抛错并指出是哪一项", () => {
    expect(() => defineRequirements({ name: "X", why: "x" } as never)).toThrowError(/X.*缺少 kind/);
  });

  it("缺 why 时抛错（它要显示在页面上）", () => {
    expect(() => defineRequirements({ name: "X", kind: "var" } as never)).toThrowError(/缺少 why/);
  });

  it("正确的两种形态都能工作", () => {
    expect(defineRequirements(REQUIREMENTS.passkey).length).toBeGreaterThan(0);
    expect(defineRequirements({ name: "A", kind: "var", why: "a" }).length).toBe(1);
  });
});

describe("authPageResponse 路径同样生效", () => {
  it("缺配置时返回 200 + 清单（用户要在浏览器里看到缺什么，不能是 5xx）", async () => {
    const res = authPageResponse({
      view: "setup",
      serviceName: "Tower",
      basePath: "/tower",
      env: {},
      requirements: REQS,
      lang: "zh",
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('class="cfg-panel" role="alert"');
    expect(html).not.toContain('id="setup-btn"');
    // 阻断区条目数 == 判定为 blocking 的项数（建议项单独分区，不计入）
    expect(countBlockingItems(html)).toBe(evaluateRequirements({}, REQS).blocking.length);
  });

  it("建议项（required:false）不计入阻断清单", async () => {
    // REQUIREMENTS.passkey 含建议项 ALLOWED_ORIGINS；它不得让清单条目数虚增
    const reqs = defineRequirements(REQUIREMENTS.passkey);
    expect(reqs.some((r) => r.name === "ALLOWED_ORIGINS" && r.required === false)).toBe(true);
    const res = authPageResponse({
      view: "setup",
      serviceName: "Tower",
      env: {},
      requirements: reqs,
      lang: "zh",
    });
    const html = await res.text();
    // 阻断区只有 RP_ID / ORIGIN；ALLOWED_ORIGINS 落在建议区
    expect(countBlockingItems(html)).toBe(2);
    // 但它仍然会被展示出来 —— 建议项不阻断，却不该被藏起来
    expect(html).toContain("ALLOWED_ORIGINS");
    expect(html).toContain("cfg-section-advisory");
  });

  it("配置齐备时返回正常初始化表单", async () => {
    const res = authPageResponse({
      view: "setup",
      serviceName: "Tower",
      basePath: "/tower",
      env: FULL_ENV,
      requirements: REQS,
      lang: "zh",
    });
    const html = await res.text();
    expect(html).toContain('id="setup-btn"');
    expect(html).not.toContain('class="cfg-panel" role="alert"');
  });

  it("其他视图（login）不受 env/requirements 影响", async () => {
    const res = authPageResponse({
      view: "login",
      serviceName: "Tower",
      basePath: "/tower",
      env: {},
      requirements: REQS,
      lang: "zh",
    });
    const html = await res.text();
    expect(html).not.toContain('class="cfg-panel" role="alert"');
    expect(html).toContain("Passkey");
  });
});
