/**
 * 环境变量访问扫描（`src/config/scan.ts`）与词法剥离（`src/config/strip.ts`）测试
 *
 * ## 为什么这些用例长这样
 *
 * 这里的每一条几乎都是**开发过程中真实踩到的坑**，不是设想出来的边界。
 * 词法剥离尤其危险：它一旦失步，报错点会在几百行之外，且现象是
 * "TSDoc 里的示例 `env.FOO` 被当成真实访问"——很容易被误判成扫描器不准。
 *
 * 因此本文件同时锁定：
 *
 * 1. 剥离器的**正确性**（不吞代码、不漏抹注释、行列号一致）
 * 2. 分类的**误报控制**（本仓库真实源码上必须零误报）
 * 3. 该报的必须报出来（否则工具没有价值）
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  stripCommentsAndStrings,
} from "../../src/config/strip.js";
import {
  scanEnvAccess,
  bareAccesses,
  configuredKeySet,
  reportUndeclaredEnv,
  reportUnusedConfig,
} from "../../src/config/scan.js";
import { REQUIREMENTS, defineRequirements } from "../../src/config/requirements.js";

/* ------------------------------------------------------------------ 辅助 */

const find = (accesses: ReturnType<typeof scanEnvAccess>, name: string) =>
  accesses.find((a) => a.name === name);

/** 本仓库真实源码的全量扫描（用于"零误报"门禁） */
function scanRepo(dir = "src"): ReturnType<typeof scanEnvAccess> {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|js)$/.test(e) && !e.endsWith(".d.ts")) files.push(p);
    }
  };
  walk(dir);
  const out: ReturnType<typeof scanEnvAccess> = [];
  for (const f of files) out.push(...scanEnvAccess(readFileSync(f, "utf8"), f));
  // 合并同名，取最严格类别
  const sev = { defaulted: 0, guarded: 1, bare: 2 } as const;
  const byName = new Map<string, (typeof out)[number]>();
  for (const a of out) {
    const p = byName.get(a.name);
    if (!p) byName.set(a.name, { ...a });
    else if (sev[a.kind] > sev[p.kind]) byName.set(a.name, { ...p, kind: a.kind, count: p.count + a.count });
  }
  return [...byName.values()].sort((x, y) => x.name.localeCompare(y.name));
}

/* ============================================================ 词法剥离 */

describe("stripCommentsAndStrings：把噪声剔掉", () => {
  it("抹掉行注释与块注释，保留代码", () => {
    const src = `const a = 1; // env.SECRET_IN_LINE_COMMENT\n/* env.SECRET_IN_BLOCK */\nconst b = 2;`;
    const out = stripCommentsAndStrings(src);
    expect(out).not.toContain("SECRET_IN_LINE_COMMENT");
    expect(out).not.toContain("SECRET_IN_BLOCK");
    expect(out).toContain("const a = 1;");
    expect(out).toContain("const b = 2;");
  });

  it("抹掉字符串字面量", () => {
    const out = stripCommentsAndStrings(`const s = "env.STRING_LITERAL";`);
    expect(out).not.toContain("STRING_LITERAL");
    expect(out).toContain("const s =");
  });

  it("保留模板字符串 ${} 内的代码（那是真实访问）", () => {
    const out = stripCommentsAndStrings("const s = `prefix env.IN_STRING ${env.REAL_ACCESS} suffix`;");
    expect(out).not.toContain("IN_STRING");
    expect(out).toContain("env.REAL_ACCESS");
  });


  it("字符串字面量必须保留首尾引号（否则字面量比较的守卫会被漏判）", () => {
    // `env.FOO === "modern"` 是取值检查；若引号被一并抹掉，文本变成
    // `env.FOO ===`，比较对象消失，该守卫会被漏判为裸访问。
    const out = stripCommentsAndStrings(`if (env.FOO === "modern") {}`);
    expect(out).toContain('"'); // 引号仍在
    expect(out).toContain("==="); // 比较运算符仍在
    expect(out).not.toContain("modern"); // 但内容被抹掉
  });

  it("保留引号不影响噪声剥离：字面量内容仍不可见", () => {
    const out = stripCommentsAndStrings(`const s = "env.SHOULD_NOT_APPEAR";`);
    expect(out).not.toContain("SHOULD_NOT_APPEAR");
  });

  it("模板字面量同样保留反引号", () => {
    const out = stripCommentsAndStrings("const v = env.FOO === `modern`;");
    expect(out).toContain("`");
    expect(out).not.toContain("modern");
  });

  it("输出与输入等长且换行位置一致（行列号可信）", () => {
    const src = "line1 // c\nline2 /* c */\nline3\n";
    const out = stripCommentsAndStrings(src);
    expect(out).toHaveLength(src.length);
    expect(out.split("\n")).toHaveLength(src.split("\n").length);
  });

  /* --------------------- 下面三条是真实踩过的坑 --------------------- */

  it("坑① 正则字面量里的引号不得被当成字符串开头（曾吞掉后续所有注释）", () => {
    // 真实来源：scan.ts 自身的 INDEXED_RE
    const src = [
      "const RE = /env\\s*\\[\\s*[\"'`]([A-Za-z_]+)[\"'`]\\s*\\]/g;",
      "/** 文档里提到 env.IN_DOC_COMMENT */",
      "const x = 1;",
    ].join("\n");
    const out = stripCommentsAndStrings(src);
    expect(out, "正则字面量应整体抹掉").not.toContain("[A-Za-z_]");
    expect(out, "后续注释必须仍被抹掉").not.toContain("IN_DOC_COMMENT");
    expect(out).toContain("const x = 1;");
  });

  it("坑② 模板插值闭合后不得跳过闭合反引号（曾导致词法状态失步）", () => {
    const src = [
      "const a = `${p}lock:${k}`;",
      "/** 文档示例 env.AFTER_TEMPLATE */",
      "const b = 2;",
    ].join("\n");
    const out = stripCommentsAndStrings(src);
    expect(out).not.toContain("AFTER_TEMPLATE");
    expect(out).toContain("const b = 2;");
  });

  it("坑③ 未闭合的字符串止于行尾，不得吞掉整份文件", () => {
    const src = `const a = "unterminated\nconst SECRET_AFTER = 1;\n`;
    const out = stripCommentsAndStrings(src);
    expect(out, "行之后的代码必须保留").toContain("SECRET_AFTER");
  });
});

/* ============================================================ 访问识别 */

describe("scanEnvAccess：识别访问形态", () => {
  it("识别 env.FOO / env['FOO'] / env[\"FOO\"]（索引里的字符串不可被抹除）", () => {
    const a = scanEnvAccess(`x = env.A; y = env["B"]; z = env['C'];`);
    expect(a.map((v) => v.name)).toEqual(["A", "B", "C"]);
  });

  it("识别 env?.FOO 可选链并判为 defaulted", () => {
    const a = scanEnvAccess(`const t = env?.UI_THEME;`);
    expect(find(a, "UI_THEME")?.kind).toBe("defaulted");
  });

  it("识别 env?.[\"FOO\"] 可选链索引访问（合法 JS，此前完全漏掉）", () => {
    // `?.` 是 `?` `.` 两个字符：`env?.[` 中间那个点不能省，
    // 写成 `\\?\\s*\\[` 会永远匹配不上
    const a = scanEnvAccess(`const t = env?.["BRACKETED"];`);
    expect(find(a, "BRACKETED")?.kind).toBe("defaulted");
  });

  it("识别解构 const { A, B = \"x\" } = env", () => {
    const a = scanEnvAccess(`const { ALPHA, BETA = "d" } = env;`);
    expect(find(a, "ALPHA")?.kind).toBe("bare");
    expect(find(a, "BETA")?.kind).toBe("defaulted");
  });


  it("解构带改名 { FOO: local } 必须识别出变量名 FOO", () => {
    // 曾把名字算成字符串 "FOO: local"，既不匹配命名形状、又拿一个不存在的名字
    // 去查守卫 —— 整条访问直接从报告里消失。
    const a = scanEnvAccess(`const { FOO: local } = env;\nuse(local);`);
    expect(find(a, "FOO")?.kind).toBe("bare");
    expect(a.map((v) => v.name)).not.toContain("FOO: local");
  });

  it("解构带改名且局部别名有守卫 → guarded", () => {
    const src = `const { FOO: local } = env;\nif (local) { use(local); }`;
    expect(find(scanEnvAccess(src), "FOO")?.kind).toBe("guarded");
  });

  it("解构带改名且默认值 → defaulted", () => {
    expect(find(scanEnvAccess(`const { FOO: l = "d" } = env;`), "FOO")?.kind).toBe("defaulted");
  });

  it("排除 process.env.X 与 import.meta.env.X（Node/构建期变量，不是绑定）", () => {
    const a = scanEnvAccess(`process.env.DEBUG_SERVER; import.meta.env.VITE_X; env.REAL_ONE;`);
    expect(a.map((v) => v.name)).toEqual(["REAL_ONE"]);
  });

  it("排除写入 env.FOO = 1", () => {
    const a = scanEnvAccess(`env.WRITTEN = 1; env.READ_ONE;`);
    expect(a.map((v) => v.name)).toEqual(["READ_ONE"]);
  });

  it("索引访问 env[\"FOO\"] 仍被识别（曾因字符串被抹掉而完全漏掉）", () => {
    const a = scanEnvAccess(`const v = env["QUOTED_NAME"] ?? "d";`);
    expect(find(a, "QUOTED_NAME")?.kind).toBe("defaulted");
  });

  it("默认只认全大写名（wrangler 命名惯例）；可用 namePattern 放宽", () => {
    expect(scanEnvAccess(`env.lowercaseVar;`).map((a) => a.name)).toEqual([]);
    const relaxed = scanEnvAccess(`env.lowercaseVar;`, "s", { namePattern: null });
    expect(relaxed.map((a) => a.name)).toEqual(["lowercaseVar"]);
  });

  it("locations 里的行号与原文一致", () => {
    const src = "const a = 1;\nconst b = 2;\nconst c = env.THIRD_LINE;\n";
    expect(find(scanEnvAccess(src, "f.ts"), "THIRD_LINE")?.locations).toEqual(["f.ts:3"]);
  });
});

/* ============================================================ 分类 */

describe("scanEnvAccess：分类（是否要求配置）", () => {
  const kindOf = (src: string, name = "FOO") => find(scanEnvAccess(src), name)?.kind;

  it("defaulted：?? 与 || 兜底", () => {
    expect(kindOf(`const v = env.FOO ?? "d";`)).toBe("defaulted");
    expect(kindOf(`const v = env.FOO || "d";`)).toBe("defaulted");
  });

  it("坑④ ?? 链的**后续项**同样有兜底（只看后缀会误报）", () => {
    // 真实来源：src/sync/sender.ts 与 src/sync/receiver.ts
    expect(kindOf(`const v = env.A ?? env.FOO;`)).toBe("defaulted");
    expect(kindOf(`const v = env.A ?? env.B ?? env.FOO;`)).toBe("defaulted");
  });

  it("guarded：if / && / ? : 布尔守卫", () => {
    expect(kindOf(`if (env.FOO) { use(); }`)).toBe("guarded");
    expect(kindOf(`if (!env.FOO) { return; } use(env.FOO);`)).toBe("guarded");
    expect(kindOf(`const ok = env.FOO && env.BAR;`)).toBe("guarded");
    expect(kindOf(`const ok = env.A && env.FOO;`)).toBe("guarded");
    expect(kindOf(`const v = env.FOO ? 1 : 2;`)).toBe("guarded");
  });

  it("guarded：typeof 与 undefined/null 比较", () => {
    expect(kindOf(`if (typeof env.FOO === "string") { use(env.FOO); }`)).toBe("guarded");
    expect(kindOf(`if (env.FOO === undefined) { return; } use(env.FOO);`)).toBe("guarded");
  });

  it("坑⑤ if (…) 条件的守卫必须覆盖到块内（守卫在 { 之前）", () => {
    // 真实来源：src/ui/auth-pages.ts 的 UI_THEME
    const src = `if (opts?.env?.FOO === "modern") {\n  return opts.env.FOO;\n}`;
    expect(kindOf(src)).toBe("guarded");
  });

  it("坑⑥ 无花括号的 if (X) return Y; 形态", () => {
    // 真实来源：src/email 之外的 R2_PUBLIC_URL 写法
    const src = `if (env.FOO) return env.FOO.replace(/\\/+$/, "");\n`;
    expect(kindOf(src)).toBe("guarded");
  });


  /* ------- 以下四条都是**漏报**方向的修复（漏报会让 CI 门禁形同虚设） ------- */

  it("坑⑧ 冒号不是守卫：三元假分支 / 对象字面量 / switch case", () => {
    // `:` 出现在这三种位置都不是"存在性检查"
    expect(kindOf(`const v = c ? 0 : env.FOO;`)).toBe("bare");
    expect(kindOf(`const o = { k: env.FOO };`)).toBe("bare");
    expect(kindOf(`switch (k) { case env.FOO: break; }`)).toBe("bare");
  });

  it("坑⑨ 与未知值比较不构成守卫（与字面量比较才构成）", () => {
    // `env.FOO === other` 只是比较，完全不能说明 FOO 存在
    expect(kindOf(`if (env.FOO === other) {}`)).toBe("bare");
    expect(kindOf(`if (env.FOO === computed) { return env.FOO.x; }`)).toBe("bare");
    // 而与字面量比较是取值检查，判 guarded
    expect(kindOf(`if (env.FOO === "modern") { return env.FOO.x; }`)).toBe("guarded");
    expect(kindOf(`if (env.FOO === 1) { return env.FOO.x; }`)).toBe("guarded");
  });

  it("坑⑩ == null / === undefined 是合法的存在性检查", () => {
    expect(kindOf(`if (env.FOO == null) { return; } use(env.FOO);`)).toBe("guarded");
    expect(kindOf(`if (env.FOO === undefined) { return; } use(env.FOO);`)).toBe("guarded");
  });

  it("正则字面量里的 env.FOO 是噪声，不是访问", () => {
    expect(scanEnvAccess(`const r = /env\\.FOO/;`)).toEqual([]);
  });

  it("坑⑦ 一跳局部别名：const w = env.FOO; if (w) …", () => {
    // 真实来源：src/email/index.ts 的 EMAIL_WEBHOOK_URL
    const src = `const webhookUrl = env.FOO;\nif (webhookUrl && webhookUrl.startsWith("http")) {\n  return webhookUrl;\n}`;
    expect(kindOf(src)).toBe("guarded");
  });

  it("bare：既无兜底也无守卫", () => {
    expect(kindOf(`await env.FOO.doThing();`)).toBe("bare");
    expect(kindOf(`const secret = env.FOO || "";`)).toBe("defaulted");
  });

  it("非空断言 env.FOO! 仍算裸访问（那是声明必填，不是可选）", () => {
    expect(kindOf(`call(env.FOO!, "x");`)).toBe("bare");
  });

  it("同名多处取最严格类别，并保留分布", () => {
    const a = scanEnvAccess(`const v = env.FOO ?? 1;\nconst w = env.FOO;\n`);
    const foo = find(a, "FOO")!;
    expect(foo.kind).toBe("bare");
    expect(foo.count).toBe(2);
    expect(foo.kinds).toEqual({ defaulted: 1, bare: 1 });
  });

  it("TSDoc 里的示例 env.FOO 不算访问", () => {
    const a = scanEnvAccess(`/** 请配置 \`env.DOC_ONLY\` */\nexport const x = 1;`);
    expect(a).toEqual([]);
  });
});

/* ============================================================ 报告 */

describe("reportUndeclaredEnv：找出「读了但没配」的", () => {
  it("无配置清单时不做臆测（宁可少报也不误报）", () => {
    const a = scanEnvAccess(`const v = env.FOO;`);
    expect(reportUndeclaredEnv(a, {})).toEqual([]);
    expect(reportUndeclaredEnv(a)).toEqual([]);
  });

  it("裸访问且不在清单里 → 报告", () => {
    const a = scanEnvAccess(`const v = env.FOO; const d = env.BAR ?? 1;`);
    const r = reportUndeclaredEnv(a, { vars: ["BAR"] });
    expect(r.map((x) => x.name)).toEqual(["FOO"]);
    expect(r[0]?.locations[0]).toContain(":1");
  });

  it("有兜底 / 有守卫的项不报", () => {
    const a = scanEnvAccess([
      `const a = env.WITH_DEFAULT ?? "d";`,
      `if (env.WITH_GUARD) { use(); }`,
    ].join("\n"));
    expect(reportUndeclaredEnv(a, { vars: [] })).toEqual([]);
  });

  it("vars / bindings / secrets 三类清单都算已配置", () => {
    const set = configuredKeySet({ vars: ["V"], bindings: ["B"], secrets: ["S"] });
    expect([...set].sort()).toEqual(["B", "S", "V"]);
  });
});

describe("reportUnusedConfig：残留配置（仅提示）", () => {
  it("声明了但代码从不裸访问 → 列出", () => {
    const a = scanEnvAccess(`const v = env.USED ?? 1;`);
    expect(reportUnusedConfig(a, { vars: ["USED", "ORPHAN"] })).toEqual(["ORPHAN"]);
  });

  it("代码裸访问的项不算残留", () => {
    const a = scanEnvAccess(`const v = env.NEEDED;`);
    expect(reportUnusedConfig(a, { bindings: ["NEEDED"] })).toEqual([]);
  });
});

/* ============================================================ 真实源码门禁 */

describe("门禁：真实源码上的裸访问必须逐一有结论", () => {
  const accesses = scanRepo();

  /**
   * 人工核对过的裸访问清单。
   *
   * 这里刻意**不是**"零裸访问"：真实代码里确实存在裸访问，把它写成
   * 「必须为空」的断言会诱使人去放宽扫描器（本次开发中就差点这么做）。
   * 正确做法是把真值钉住 —— 新增任何一项都会让此门禁失败，
   * 迫使作者给出结论（登记为必填 / 加兜底 / 说明为何可选）。
   */
  const CONFIRMED: Record<string, string> = {
    // REQUIRED：确实是必填项，且已登记在 REQUIREMENTS.passkey
    ORIGIN: "REQUIREMENTS.passkey 已登记；缺失时 WebAuthn 验签 fail-closed",

    // OPTIONAL：代码裸访问，但语义上可选。
    // 扫描器看不到 `parseOriginAllowlist(value, fallback?)` 的第二参是可选的 ——
    // 跨函数的默认值不在局部作用域内，这是静态分析的固有边界。
    ALLOWED_ORIGINS: "parseOriginAllowlist 的可选第二参，缺失即不加该来源",
  };

  it("识别出足量变量（证明扫描确实在工作，而非什么都没扫到）", () => {
    expect(accesses.length, "至少应识别 20 个环境变量").toBeGreaterThanOrEqual(20);
  });

  it("裸访问集合与人工确认清单完全一致", () => {
    const bare = bareAccesses(accesses);
    expect(
      bare.map((b) => b.name).sort(),
      "新增裸访问时，请在此登记结论：必填（并加进 REQUIREMENTS）/ 可选（加兜底）/ 静态分析看不到（在此写明理由）",
    ).toEqual(Object.keys(CONFIRMED).sort());
  });

  it("确认为必填的项，必须真的登记在 REQUIREMENTS 里", () => {
    const declared = new Set(
      Object.values(REQUIREMENTS).flat().map((r: { name: string }) => r.name),
    );
    for (const [name, why] of Object.entries(CONFIRMED)) {
      if (!why.startsWith("REQUIREMENTS")) continue;
      expect(declared, `${name} 被确认为必填却没登记`).toContain(name);
    }
  });

  it("关键变量都被识别到（防止扫描器整体失效）", () => {
    // 只列 kit 自己确实会读的；COOKIE_SECRET / RATE_LIMITER_DO 等由服务侧读取，
    // 出现在 REQUIREMENTS 预设里但 kit 的 src/ 并无 env.X 访问。
    for (const name of ["DB", "RP_ID", "ORIGIN", "AUTH_SESSION_DO_SECRET", "RESEND_API_KEY"]) {
      expect(accesses.map((a) => a.name), `应识别 ${name}`).toContain(name);
    }
  });
});

/* ============================================================ 与 requirements 衔接 */

describe("扫描结果与 requirements 互补（覆盖你没发现的那部分）", () => {
  it("REQUIREMENTS 预设自身自洽：kind 合法、why 非空、无组内重复", () => {
    const KINDS = new Set(["secret", "binding", "var", "apiKey"]);
    for (const [group, items] of Object.entries(REQUIREMENTS)) {
      const seen = new Set<string>();
      for (const r of items as ReadonlyArray<{ name: string; why: string; kind: string; required?: boolean }>) {
        expect(r.name, `${group} 缺 name`).toBeTruthy();
        expect(r.why, `${group}.${r.name} 缺 why`).toBeTruthy();
        expect(KINDS.has(r.kind), `${group}.${r.name} 的 kind 非法: ${r.kind}`).toBe(true);
        expect(seen.has(r.name), `${group} 内 ${r.name} 重复`).toBe(false);
        seen.add(r.name);
      }
    }
  });

  it("组合需求后仍不抛错（与扫描器共存）", () => {
    expect(() =>
      defineRequirements(REQUIREMENTS.passkey, REQUIREMENTS.session, {
        name: "SCANNED_EXTRA",
        kind: "secret",
        why: "扫描器发现但尚未登记的密钥",
      }),
    ).not.toThrow();
  });
});
