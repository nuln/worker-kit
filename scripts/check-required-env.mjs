#!/usr/bin/env node
/**
 * 扫描服务源码，找出「代码读了、但配置里没有」的环境变量。
 *
 * ## 为什么需要它
 *
 * `/setup` 的前置检查依赖服务显式声明 `requirements`。但只要开发者新读了一个
 * `env.FOO` 却忘了登记，检查就形同虚设 —— 而这恰恰是最危险的一类缺陷
 * （用户配完 Passkey 才发现邮件根本没发出去）。
 *
 * 本脚本**不依赖人工登记**：直接从源码静态扫描 `env` 的访问，
 * 与 `wrangler.jsonc` 声明的 vars / bindings 比对，把漏掉的暴露出来。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/check-required-env.mjs <service-dir> [--json] [--warn] [--quiet]
 * ```
 *
 * | 参数 | 作用 |
 * |---|---|
 * | `--json` | 输出 JSON（供 CI / 其他工具消费） |
 * | `--warn` | 有问题时仍以 0 退出（只提示不阻断） |
 * | `--quiet` | 只输出问题，不输出统计 |
 *
 * 退出码：有问题 = 1（`--warn` 时 = 0）。
 *
 * ## 判定口径
 *
 * 每个 `env.X` 访问点按语法归类（详见 `src/config/scan.ts`）：
 *
 * - `defaulted` — 有兜底（`??` / `||` / `?.` / 解构默认值）→ 不要求配置
 * - `guarded`   — 邻近作用域有判空 / typeof / 布尔守卫 → 不要求配置
 * - `bare`      — 以上都没有 → **要求配置**，若配置里没有则报告
 *
 * ## "已配置"的判定
 *
 * 合并三处来源：
 *
 * 1. `wrangler.jsonc` 的 `vars` 与各类绑定（d1_databases / kv_namespaces / …）
 * 2. kit 内置的 `REQUIREMENTS` 预设里出现的名字（这些是**密钥**，
 *    由 `wrangler secret put` 注入，本来就不会出现在 wrangler.jsonc）
 * 3. `<service>/.secrets.json` 里显式列出的密钥名（可选，服务特有）
 *
 * @module scripts/check-required-env
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanEnvAccess, bareAccesses, configuredKeySet } from "../src/config/scan.ts";
import { REQUIREMENTS } from "../src/config/requirements.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..");

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));
const asJson = flags.has("--json");
const neverFail = flags.has("--warn");
const quiet = flags.has("--quiet");

const target = positional[0] ? resolve(process.cwd(), positional[0]) : process.cwd();

/* ------------------------------------------------------------------ 工具 */

/** 去掉 JSONC 注释（wrangler.jsonc 允许 `//` 与 `/* *\/`） */
function stripJsonc(text) {
  return text
    .replace(/\\"|"(?:\\"|[^"])*"|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g, (m, c) => (c ? "" : m))
    .replace(/,(\s*[}\]])/g, "$1");
}

/**
 * 递归收集源码文件。
 *
 * ## 为什么要排除 test
 *
 * 本脚本回答的问题是"运维必须配置哪些变量才能让**实际运行的代码**工作"。
 * 测试不会部署到线上，而且测试里出现的 `env.X` 往往是**字符串样本**
 * （比如验证扫描器自身行为的 `scanEnvAccess("env.A;")`），把它们算成
 * "代码读了 env.A" 会让门禁对着一堆测试夹具报一堆假阳性。
 *
 * 排除是按目录名匹配的（`test` / `tests` / `__tests__` / `spec`），
 * 不依赖具体路径，因此对各微服务的仓库布局同样成立。
 */
const SKIP_DIRS = new Set([
  "node_modules", "dist", ".wrangler", ".git", "coverage", "build", ".next",
  "test", "tests", "__tests__", "spec", "__mocks__", "e2e",
]);

function walk(dir, out = []) {
  const SKIP = SKIP_DIRS;
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const p = join(dir, entry);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry) && !/\.d\.ts$/.test(entry)) out.push(p);
  }
  return out;
}

/**
 * Cloudflare wrangler 中**表示绑定数组**的键。
 *
 * 只有这些键下的 `name` 才是绑定名 —— 不能见到 `name` 就收，
 * 因为 `routes: [{ pattern, name }]` 里的 `name` 是自定义域名，不是绑定。
 */
const BINDING_CONTAINERS = new Set([
  "d1_databases", "kv_namespaces", "r2_buckets", "durable_objects", "services",
  "queues", "send_email", "ai", "browser", "vectorize", "workflows", "hyperdrive",
  "dispatch_namespaces", "mtls_certificates", "analytics_engine_datasets",
  "secrets_store_secrets", "version_metadata", "assets", "bindings",
]);

/**
 * 从 wrangler 配置里递归收集所有绑定名。
 *
 * wrangler 的绑定节点形状并不统一，不能按固定键名枚举：
 *
 * ```jsonc
 * "d1_databases":     [{ "binding": "DB" }]                     // 用 binding
 * "send_email":       [{ "name": "SEND_EMAIL" }]                  // 用 name
 * "durable_objects":  { "bindings": [{ "name": "INBOX_DO" }] }   // 用 name，且多包一层
 * "assets":           { "binding": "ASSETS" }                    // 对象形态
 * ```
 *
 * 曾因只认 `binding` 而漏掉 `send_email[].name` / `durable_objects.bindings[].name`，
 * 把已正确声明的 `SEND_EMAIL`、`INBOX_DO` 误报成"未配置"。因此改为递归 + 容器键白名单。
 */
function collectBindings(node, out, parentKey = "") {
  if (Array.isArray(node)) {
    for (const item of node) {
      if (!item || typeof item !== "object") continue;
      if (typeof item.binding === "string") out.add(item.binding);
      else if (BINDING_CONTAINERS.has(parentKey) && typeof item.name === "string") {
        out.add(item.name);
      }
      collectBindings(item, out, "");
    }
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      // `assets: { binding: "ASSETS" }` 这类对象形态
      if (k === "binding" && typeof v === "string") out.add(v);
      else collectBindings(v, out, k);
    }
  }
}

/** 从 wrangler 配置里取出所有已声明的键名 */
function declaredInWrangler(dir) {
  const result = { vars: [], bindings: [], file: null };
  for (const name of ["wrangler.jsonc", "wrangler.json"]) {
    const p = join(dir, name);
    if (!existsSync(p)) continue;
    result.file = relative(process.cwd(), p);
    let cfg;
    try {
      cfg = JSON.parse(stripJsonc(readFileSync(p, "utf8")));
    } catch (e) {
      throw new Error(`无法解析 ${p}: ${e.message}`);
    }
    // vars：所有环境层级（顶层 + env.*）都要算进去
    const collectVars = (node) => {
      for (const k of Object.keys(node?.vars ?? {})) result.vars.push(k);
      for (const v of Object.values(node?.env ?? {})) if (v) collectVars(v);
    };
    collectVars(cfg);

    // 其余节点全部交给递归收集
    const bindings = new Set();
    const { vars, env, ...rest } = cfg;
    collectBindings(rest, bindings, "");
    for (const envCfg of Object.values(env ?? {})) {
      if (!envCfg) continue;
      const { vars: _v, env: _e, ...erest } = envCfg;
      collectBindings(erest, bindings, "");
    }
    result.bindings = [...bindings];
    break;
  }
  return result;
}

/** 读取服务自报的密钥清单（可选） */
function declaredInSecretsFile(dir) {
  const p = join(dir, ".secrets.json");
  if (!existsSync(p)) return [];
  try {
    const v = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : Array.isArray(v.secrets) ? v.secrets : [];
  } catch {
    return [];
  }
}

/** kit 内置预设里出现过的名字 —— 这些都是密钥，不在 wrangler.jsonc 里 */
function knownKitSecrets() {
  const names = new Set();
  for (const group of Object.values(REQUIREMENTS)) {
    for (const r of group) names.add(r.name);
  }
  return [...names];
}

/* ------------------------------------------------------------------ 主流程 */

if (!existsSync(target) || !statSync(target).isDirectory()) {
  console.error(`✘ 目录不存在: ${target}`);
  process.exit(2);
}

const files = walk(target);
if (files.length === 0) {
  console.error(`✘ 未找到任何源码文件: ${target}`);
  process.exit(2);
}

const accesses = [];
for (const f of files) {
  let src;
  try {
    src = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  accesses.push(...scanEnvAccess(src, relative(process.cwd(), f)));
}

// 合并同名变量，取最严格类别，保留全部位置
const SEVERITY = { defaulted: 0, guarded: 1, bare: 2 };
const byName = new Map();
for (const a of accesses) {
  const prev = byName.get(a.name);
  if (!prev) {
    byName.set(a.name, { ...a });
    continue;
  }
  prev.count += a.count;
  if (SEVERITY[a.kind] > SEVERITY[prev.kind]) prev.kind = a.kind;
  prev.locations.push(...a.locations);
  if (a.bareLocations) prev.bareLocations = [...(prev.bareLocations ?? []), ...a.bareLocations];
  for (const [k, v] of Object.entries(a.kinds ?? {})) {
    prev.kinds ??= {};
    prev.kinds[k] = (prev.kinds[k] ?? 0) + v;
  }
}
const merged = [...byName.values()].sort((x, y) => x.name.localeCompare(y.name));

const wrangler = declaredInWrangler(target);
const serviceSecrets = declaredInSecretsFile(target);
const kitNames = knownKitSecrets();
const configured = configuredKeySet({
  vars: [...new Set([...wrangler.vars, ...kitNames, ...serviceSecrets])],
  bindings: wrangler.bindings,
  secrets: [...new Set([...kitNames, ...serviceSecrets])],
});

// ① 代码裸访问、但配置里没有 → 必须登记
const undeclared = bareAccesses(merged).filter((a) => !configured.has(a.name));

// ② 配置里声明了、但代码从不裸访问 → 可能是重构残留（仅提示）
const accessedBare = new Set(bareAccesses(merged).map((a) => a.name));
const unused = [...configured]
  .filter((k) => !accessedBare.has(k) && !kitNames.includes(k) && !serviceSecrets.includes(k))
  .sort();

/* ------------------------------------------------------------------ 输出 */

if (asJson) {
  console.log(
    JSON.stringify(
      {
        target: relative(process.cwd(), target),
        files: files.length,
        wrangler: wrangler.file,
        total: merged.length,
        byKind: {
          defaulted: merged.filter((a) => a.kind === "defaulted").length,
          guarded: merged.filter((a) => a.kind === "guarded").length,
          bare: merged.filter((a) => a.kind === "bare").length,
        },
        undeclared: undeclared.map((a) => ({
          name: a.name,
          count: a.count,
          kinds: a.kinds,
          // 给出"让它被判 bare 的那些行"，而不是随便前几个位置
          bareLocations: (a.bareLocations ?? a.locations).slice(0, 8),
        })),
        unused,
      },
      null,
      2,
    ),
  );
} else {
  const rel = relative(process.cwd(), target) || ".";
  if (!quiet) {
    console.log(`\n扫描 ${rel} —— ${files.length} 个源文件，识别 ${merged.length} 个环境变量`);
    console.log(
      `  有兜底 ${merged.filter((a) => a.kind === "defaulted").length}` +
        ` · 有守卫 ${merged.filter((a) => a.kind === "guarded").length}` +
        ` · 裸访问 ${merged.filter((a) => a.kind === "bare").length}` +
        (wrangler.file ? `\n  配置来源: ${wrangler.file}` : "\n  ⚠ 未找到 wrangler.jsonc，无法比对" +
          (kitNames.length ? `（仅比对 kit 内置预设的 ${kitNames.length} 个名字）` : "")),
    );
  }

  if (undeclared.length === 0) {
    if (!quiet) console.log("\n✔ 没有「代码读了但配置里没有」的环境变量。\n");
  } else {
    console.log(`\n✘ ${undeclared.length} 个环境变量被代码裸访问、但配置里没有：\n`);
    for (const a of undeclared) {
      const dist = a.kinds
        ? Object.entries(a.kinds).map(([k, v]) => `${k}×${v}`).join(" ")
        : "";
      console.log(`  ${a.name}   共 ${a.count} 处访问 [${dist}] —— 以下为无兜底处:`);
      for (const l of (a.bareLocations ?? a.locations).slice(0, 3)) {
        const [f, ln] = l.split(":");
        let text = "";
        try {
          text = readFileSync(join(process.cwd(), f), "utf8").split("\n")[Number(ln) - 1]?.trim() ?? "";
        } catch {
          /* 读不到就只显示位置 */
        }
        console.log(`      ${l}`);
        if (text) console.log(`        ${text.slice(0, 100)}`);
      }
    }
    console.log(
      "\n  处理方式（二选一）：\n" +
        "    ① 若确实必填 → 加进该服务的 requirements（/setup 会列为必须配置）\n" +
        "    ② 若本就可选   → 在使用处加默认值或守卫，然后重跑本脚本\n" +
        "  两者都不做就等于把这个变量藏起来了：出问题时没有任何地方会提示。\n",
    );
  }

  if (unused.length && !quiet) {
    console.log(`\n· ${unused.length} 个已配置但代码从不裸访问（可能是重构残留，仅提示）：`);
    console.log(`  ${unused.join(" ")}\n`);
  }
}

process.exit(undeclared.length > 0 && !neverFail ? 1 : 0);
