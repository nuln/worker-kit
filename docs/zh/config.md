# @nuln/worker-kit/config — 部署预检与初始化前置检查

> English: see [`en/config.md`](./en/config.md)

## 要解决的问题

Cloudflare Worker 的绑定与密钥缺失**不会**在部署时报错：wrangler 照常发布、
代码照常接收请求，直到某条执行到 `env.SOMETHING_KV.get(...)` 才在运行期炸掉。

更糟的是那些"缺了也不报错"的路径 —— 只在后台 `console.warn` 一行，
生产环境根本看不到，于是配置缺陷**静默存在**：

| 忘记配置 | 后果 |
|---|---|
| `AUTH_SESSION_DO_SECRET` | 会话 DO 的 HTTP 入口无鉴权 → 凭据可被匿名读取 |
| `RATE_LIMITER_DO` | 限流完全失效，监控面板一片绿 |
| `RESEND_API_KEY` | 密码重置「假成功」，用户以为收到了邮件 |
| `RP_ID` / `ORIGIN` | WebAuthn 验签 fail-closed，所有人登不进去 |

以及首次访问 `/setup` 时：**无论配置是否齐全都照常渲染初始化表单** ——
用户填完邮箱、绑完 Passkey，才在后续请求上炸掉。

本模块提供统一原语：**发现缺失就抛错 / 返回 503 / 在页面上显示缺什么**，
而不是打一行日志继续跑。

---

## 两种用法

### 1. Worker 入口启动自检（推荐）

```ts
import { preflightGuard } from "@nuln/worker-kit/config";

export default {
  async fetch(request, env) {
    const denied = preflightGuard(env, {
      secrets:  { AUTH_SESSION_DO_SECRET: "会话 DO 的 HTTP 入口鉴权" },
      bindings: { DB: "D1", RATE_LIMITER_DO: "限流 DO" },
      vars:     { ORIGIN: "WebAuthn Origin 锚点" },
      apiKeys:  { RESEND_API_KEY: "邮件投递" },
    }, "tower");
    if (denied) return denied;   // 503 + 缺失清单
    // …正常业务
  },
};
```

### 2. 能力内部兜底

即使调用方忘了在入口自检，需要外部依赖的能力在被使用的那一刻也会检查：

| 能力 | 缺配置时的行为 |
|---|---|
| `AuthSessionDO.fetch()` | **503** `missing_config` + 缺失清单 |
| `AuthSessionDO.assertConfigured()` | 抛 `ConfigError`（供不经 HTTP 的调用方） |
| `RateLimitService.consume()` | `ok:false` + `error:"missing_config"` → middleware 转 **503** |
| `createEmailProvider()` | 一次性 `console.error` 提示"密码重置会假成功" |

---

## 初始化前置检查（`/setup` 页）

```ts
import { renderAuthPage, authPageResponse } from "@nuln/worker-kit";
import { defineRequirements, REQUIREMENTS } from "@nuln/worker-kit/config";

export const requirements = defineRequirements(
  REQUIREMENTS.passkey,     // RP_ID + ORIGIN
  REQUIREMENTS.session,     // COOKIE_SECRET + AUTH_SESSION_DO_SECRET
  { name: "ADMIN_EMAIL", kind: "var", why: "初始管理员邮箱" },
);

export function handleSetup(request: Request, env: any) {
  return authPageResponse({
    view: "setup", serviceName: "Tower", basePath: "/tower",
    request, env, requirements,
  });
}
```

配置缺失时页面渲染的是**清单**而不是初始化表单：

```
⚠  初始化已阻止：需要先完成配置
   Tower 目前无法进入初始化流程，因为以下配置尚未完成。

   必须配置（4）
   [环境变量]  RP_ID
     未配置 —— WebAuthn Relying Party ID（如 auth.nuln.net）—— 缺失将导致验签拒绝
     如何配置  在 wrangler.jsonc 的 vars 或 .dev.vars 中配置 RP_ID
   [密钥]      AUTH_SESSION_DO_SECRET
     未配置 —— 会话 Durable Object 的 HTTP 入口鉴权 —— 缺失时该入口已 fail-closed
     如何配置  wrangler secret put AUTH_SESSION_DO_SECRET
   …
```

同时**不注入 Passkey 注册脚本**，避免用户点"设置"后走一段注定失败的仪式。

---

## 关键设计约束：加环境变量不改代码

需求是**纯数据**（`SetupRequirement[]`），判定与渲染都是遍历，
**没有任何按变量名的 switch / 分支**。

```ts
// ① 现在这样
export const requirements = defineRequirements(
  REQUIREMENTS.passkey,
  { name: "ADMIN_EMAIL", kind: "var", why: "初始管理员邮箱" },
);

// ② 以后加变量：只加一行，页面与 API 拦截自动生效
export const requirements = defineRequirements(
  REQUIREMENTS.passkey,
  { name: "ADMIN_EMAIL", kind: "var", why: "初始管理员邮箱" },
  { name: "SMTP_HOST",   kind: "var", why: "自建邮件服务器", required: false },
);
```

这一点由测试直接锁定（`test/integration/setup-gate.test.ts` 的
「可扩展性：加环境变量不改代码」）：运行期往数组追加一项，页面立即反映并给出
对应修复命令，无需任何代码改动。

### 内置能力预设

| 预设 | 包含项 |
|---|---|
| `REQUIREMENTS.passkey` | `RP_ID` `ORIGIN` |
| `REQUIREMENTS.session` | `COOKIE_SECRET` `AUTH_SESSION_DO_SECRET` |
| `REQUIREMENTS.ratelimit` | `RATE_LIMITER_DO` |
| `REQUIREMENTS.database` | `DB` |
| `REQUIREMENTS.mail` | `RESEND_API_KEY` |
| `REQUIREMENTS.backup` | `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` `S3_BUCKET` |
| `REQUIREMENTS.sync` | `BACKUP_SYNC_SECRET` |
| `REQUIREMENTS.oidc` | `COOKIE_SECRET` `RP_ID` `ORIGIN` |

---

## API

| 函数 | 失败行为 | 返回 |
|---|---|---|
| `inspect(env, spec, kind)` | 不抛 | `ConfigReport` |
| `assertConfigured(env, spec, kind, scope)` | **抛 `ConfigError`** | `void` |
| `preflight(env, groups, scope)` | 不抛 | `ConfigReport` |
| `toConfigError(report, scope)` | 不抛 | `ConfigError \| null` |
| `configErrorResponse(err)` | — | `Response`（503 或 500） |
| `preflightGuard(env, groups, scope)` | 不抛 | `Response \| null` |
| `evaluateRequirements(env, reqs)` | 不抛 | `{ ok, blocking, advisory, all }` |
| `defineRequirements(...groups)` | **形态/字段非法时抛 `TypeError`** | `Requirements` |

### 判定口径

- `undefined` / `null` / 空串 / 空白串 → 一律算缺失
- 非字符串值（如 KVNamespace 对象）→ 视为已配置
- `required: false` → 进 `advisory`，不阻断
- 自定义 `check(v)` 返回 `false` → 视为未正确配置

### 响应格式

状态码 **503**（依赖不可用）而非 500（代码崩了）。响应体遵循
AGENTS §7.1 的统一契约：

```json
{
  "ok": false,
  "error": "service_not_configured",
  "code": "CONFIG_MISSING",
  "details": [
    { "kind": "binding", "name": "RATE_LIMITER_DO",
      "reason": "未绑定 —— 限流无法工作",
      "hint": "在 wrangler.jsonc 的对应节点声明 RATE_LIMITER_DO 绑定" }
  ]
}
```

带 `cache-control: no-store`。**`details` 绝不含任何密钥值** ——
只有名称、原因、修复指引（测试专门验证：注入的密钥不出现在报告、
页面、异常消息的任何位置）。

---

## `defineRequirements` 的形态校验

```ts
defineRequirements(REQUIREMENTS.passkey)                          // ✅ 数组
defineRequirements({ name: "A", kind: "var", why: "…" })          // ✅ 单项
defineRequirements({ A: { kind: "var", why: "…" } })              // ❌ 抛 TypeError
defineRequirements({ name: "A", why: "…" })                       // ❌ 抛 TypeError（缺 kind）
defineRequirements({ name: "A", kind: "var" })                    // ❌ 抛 TypeError（缺 why）
```

第二种错误形态曾是个真实陷阱：传 `{ A: { kind, why } }`（看起来像
"需求项的集合"）时，函数会把整个对象当成**一项** `name = "A"` 的需求，
而它的 `kind` / `why` 全是 `undefined` —— 静默产出错误结果。现显式抛错，
类型系统与运行时双重拦截。

---

## 构建期扫描：把「你没发现的那部分」也暴露出来

### 为什么声明式还不够

`/setup` 的前置检查读的是服务显式声明的 `requirements`。只要开发者新读了
一个 `env.FOO` 却忘了登记，这个变量就完全隐身：

- `/setup` 不提示、CI 不报错
- 运行时炸掉时，错误信息里只有 `undefined is not a function`

而 Worker **运行时无法枚举「代码将要读哪些变量」** —— 平台只给一个 `env`
对象，没有「已配置 / 未配置」清单。所以自动发现只能在**构建期**做：
静态扫描源码里对 `env` 的访问，与实际配置比对。

### 三层防线

```text
① 构建期  scanEnvAccess()   静态扫描源码，找出「读了但没登记」
② 声明层  requirements      纯数据声明；前置检查与 /setup 清单共用
③ 运行期  assertConfigured  缺失即抛错 / 503，绝不静默降级
```

单靠任何一层都有盲区，三层同时在才叫堵住。

### 用法

```bash
# 扫描某个服务
npm run check:env -- ../workers/tower

# 输出
扫描 ../workers/tower —— 170 个源文件，识别 39 个环境变量
  有兜底 19 · 有守卫 10 · 裸访问 10
  配置来源: ../workers/tower/wrangler.jsonc

✘ ROOT_PATH   共 17 处访问 [guarded×12 bare×1 defaulted×4] —— 以下为无兜底处:
    src/helpers.ts:14
      return normalizeBasePath(env.ROOT_PATH);
```

| 参数 | 作用 |
|---|---|
| `--json` | 输出 JSON（供 CI 消费） |
| `--warn` | 有问题时仍以 0 退出 |
| `--quiet` | 只输出问题 |

有未登记项时退出码为 1，可直接用于 CI 门禁。

### 分类判定

每个访问点按**该点自身的语法**归类：

| 类别 | 判定依据 | 是否必须配置 |
|---|---|---|
| `defaulted` | `env.FOO ?? x` / `|| x` / `?.` / 解构默认值 | 否 |
| `guarded` | 同名访问在邻近作用域内被 `&&` / `\|\|` / 三元 / 比较 / `typeof` / `!` / `if (…)` 守卫，或经**一层局部别名**守卫 | 否 |
| `bare` | 以上都没有 | **是 —— 候选必需项** |

同一变量在文件不同位置可有不同类别；汇总取**最严格**者，并保留 `kinds` 分布
与 `bareLocations` —— 报告要指出的是「让它判为 bare 的那几行」，
而不是随便前几个位置。

### `bare` 是候选，不是结论

静态分析无法证明运行时一定需要它（该分支可能永远走不到、可能被上游拦截、
也可能只是作为可选参数传给了某个函数）。因此本模块的定位是
**把人工登记漏掉的部分暴露出来供人确认**，而不是自动当成错误。

报告里每个待确认项都需要一个结论，二选一：

1. 确实必填 → 加进 `requirements`（`/setup` 会列为必须配置）
2. 本就可选 → 在使用处加默认值或守卫，然后重跑

### 真实效果（本工作区 8 个服务的实测）

> 这是一份 **2026-09-28 的实测快照**，共 31 项待确认。
> 复现：`npm run check:env -- ../workers/<service>`。
> 数字会随代码变化 —— 判定逻辑修好后**待确认项应当增加**（那是修掉了漏报，
> 不是新增噪声）。若长期不变反而要怀疑扫描器是否退化了。


| 服务 | 源文件 | 识别变量 | 待确认项 |
|---|---|---|---|
| tower | 170 | 39 | 12 |
| mail | 233 | 51 | 2 |
| push | 47 | 6 | 2 |
| oidc | 146 | 37 | 2 |
| flash | 110 | 25 | 5 |
| console | 119 | 13 | 3 |
| pay | 72 | 11 | 2 |
| haeo | 73 | 18 | 3 |

其中 `console.ADMIN_PASSWORD` 是**真实缺陷** —— 9 处裸访问，
`.dev.vars` 里也没有，生产环境一旦未注入，SSH 会话拿到
`envSecret: undefined`。

### 已知边界（诚实声明）

- **跨函数默认值看不到**：`parseAllowlist(env.FOO)` 里 `env.FOO` 判为 `bare`，
  但被调函数可能给它准备了兜底参数。这是最主要的假阳性来源。
- **正则字面量与除法不区分**：`/env\.FOO/` 内的文本会被当代码保留。
- **守卫需支配使用点**是近似的：作用域取逻辑块（300 字符上限），
  跨函数的控制流无法判定。
- 只认全大写名（`DB` / `RATE_LIMITER_DO`），可用 `namePattern` 放宽。
- **排除** `process.env.X` / `import.meta.env.X` —— 那是 Node 与构建期变量。

### 关于词法剥离（`stripCommentsAndStrings`）

本仓库 TSDoc 密度很高，注释里几乎每段都写着 `env.XXX` 之类的示例。
不剥离的话，检查会把文档里提到的几十个变量全列成"缺失"，立刻失去意义。

剥离器实现了带**正则字面量识别**的迷你词法器。原因是踩过一个很隐蔽的坑：

```ts
const INDEXED_RE = /env\s*\[\s*["'`]([A-Za-z_$]+)["'`]\s*\]/g;
```

字符类 `["'`]` 里的 `'` 被当成"字符串开始"，一路向后找下一个 `'`，
把中间所有注释当成字符串内容原样保留 —— 于是 TSDoc 里举例的
`env.AUTH_SESSION_DO_SECRET` 被误判为真实访问，而**报错点在几百行之外**。

---

## 相关

- [`auth.md`](./auth.md) — 认证页与 Passkey
- `examples/20-config-preflight-example.ts` — 预检三种用法
- `examples/21-setup-gate-example.ts` — 初始化前置检查
- `examples/22-env-scan-example.ts` — 构建期环境变量扫描
