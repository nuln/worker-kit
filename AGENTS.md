# Nuln Workspace 架构设计与工程开发规范

本规范适用于 `workers/*` 旗下所有微服务项目（OIDC, Tower, Mail, Push, Flash, Console, Pay, Haeo）与通用基础库 `@nuln/worker-kit`。
**核心目标：固化历史经验，形成单一事实来源，确保历史踩坑点与修复经验不再在任何新旧项目中重复出现。**

---

## 1. 通用能力与单一事实来源（Single Source of Truth）

1. **禁止在各个微服务中自行拼装通用 UI/HTML/JS**：
   - 所有通用认证页面（Setup 初始化、Login 登录、Invite 邀请注册、Recovery 账户恢复）必须直接使用 `@nuln/worker-kit` 导出的 `authPageResponse` 或 `renderAuthPage` 渲染。
   - 所有 UI 组件必须继承 Kit 中的 Charcoal Slate 灰白极简现代设计规范，严禁任何微服务产生私有排版分叉。

2. **默认防错接口传参（Defensive by Default）**：
   - 路由调用时，统一将 `request` 传入 `authPageResponse` 或 `renderAuthPage`：
     ```ts
     import { authPageResponse } from "@nuln/worker-kit";

     export async function handleSetup(request: Request, env: Env) {
       return authPageResponse({
         view: "setup",
         serviceName: "Tower",
         request, // Kit 会自动探测 lang 与本地/生产环境，本地开发自动填充 admin@nuln.net，生产环境严格留空
         basePath: "/tower",
       });
     }
     ```
   - 若未显式传递 `lang`，Kit 会自动从 `request` 中自适应解析语言，彻底杜绝遗漏传参导致 i18n 失效。

---

## 2. 视觉排版与交互规范（历史教训防重陷）

1. **Card 容器尺寸**：
   - 统一为 `max-width: 310px; padding: 24px 22px 18px; border-radius: 12px;`。
2. **页面标题规范**：
   - 标题统一为 `font-size: 15px; font-weight: 600; margin: 0 0 14px 0; letter-spacing: -0.01em;`，禁止使用 18px/20px 大号粗体。
   - 所有标题、按钮、占位符必须且只能使用 `AUTH_I18N` 字典中英双语，禁止硬编码中文或英文。
3. **Setup 初始化页面纯粹性**：
   - 初始化页面**仅保留**：胶囊 Header、精简标题（初始化/Setup）、管理员邮箱、管理员名称、Passkey 名称、设置主按钮。
   - **严禁**在初始化页面放置大段说明文本（Sub-description）。
   - **严禁**在初始化页面放置“使用通行密钥登录”等登录按钮。
4. **i18n 客户端即时生效**：
   - 切换语言时，前端必须同步写入 `Cookie (lang=...)` 并更新当前 URL 的 `?lang=` 参数进行即时生效。

---

## 3. Git 提交与版本控制规范（Git Discipline）

1. **语义化提交格式（Conventional Commits）**：
   - 提交信息必须遵循：`<type>(<scope>): <subject>`
   - 常用 `type`：
     - `feat`: 新功能引入
     - `fix`: 缺陷修复
     - `refactor`: 重构（不影响功能的代码结构优化）
     - `test`: 测试用例新增或调整
     - `docs`: 文档/注释更新
     - `chore`: 构建、依赖或辅助工具变动
   - `scope` 必须明确指定作用域，如：`feat(tower): ...`、`fix(kit): ...`、`test(mail): ...`、`refactor(oidc): ...`。
2. **原子化提交（Atomic Commits）**：
   - 单个 Commit 仅聚焦解决一个独立任务，严禁将多个无关改动混杂提交。
3. **提交前自检门禁（Pre-commit Gates）**：
   - 提交前必须确保本地运行 `npm run typecheck:all` 零报错，并通过相关测试用例。
4. **敏感文件零泄漏铁律**：
   - 严禁提交包含明文私钥、真实 Secret 的 `.dev.vars` 文件以及 `.wrangler/state/` 本地运行时状态。

---

## 4. 代码质量、注释与 TSDoc 规范

1. **复杂机制与协议必须包含完整注释**：
   - 涉及 **WebAuthn CBOR 编解码**、**OAuth 2.0 / OIDC 状态机与 PKCE**、**LWW（Last-Write-Wins）时间戳冲突解决**、**D1 增量同步** 等复杂机制时，必须附带详细的时序说明、设计考量与边界防御注释。
2. **公共 API / Kit 导出 TSDoc 标准**：
   - `@nuln/worker-kit` 所有导出的函数、类、接口必须提供完整 TSDoc 注释，明确注明参数含义、默认值、返回值与可能抛出的异常。
3. **注释原则**：
   - 解释“为什么这么做（Why）”以及“潜在边界约束（Caveats）”，避免编写显而易见的废话注释。
   - 严禁使用 `@ts-ignore` 掩盖类型错误，必须通过正规类型收窄或泛型约束修复。

---

## 5. D1 数据库与 Schema 演进规范

1. **物理表与模型 100% 一致**：
   - 严禁直接在 D1 线上控制台手动篡改表结构。所有改动必须同步维护在对应项目的 `schema.sql` 与 Drizzle `schema.ts` 中。
2. **向后兼容性（Backward Compatibility）**：
   - 新增列必须设置 `DEFAULT` 默认值或允许为 `NULL`，严禁线上产生阻断性 Schema 不兼容。
3. **分布式同步核心字段**：
   - 所有参与跨节点/多微服务增量同步的数据表，必须包含 `id`、`created_at`、`updated_at`（统一毫秒级时间戳），为 LWW 冲突解决与幂等同步提供底层支撑。

---

## 6. 安全、鉴权与配置规范

1. **Cookie 安全基线**：
   - 认证会话 Cookie 必须强制声明 `HttpOnly; Path=/; SameSite=Lax`（生产环境必须设置 `Secure`）。
2. **WebAuthn 验签严格性**：
   - 服务端必须严格比对 `challenge`、校验 `rpId / origin` 域名一致性，并递增核对 `signCount`，严防重放攻击。
3. **环境变量分层隔离**：
   - 本地联调：`.dev.vars.dev`（严格绑定本地端口：8787~8794）。
   - 线上发布：`.dev.vars.prod`（绑定正式域名），严禁在代码中写死环境域名。

---

## 7. 错误处理与 API 契约规范

1. **统一 API 响应格式**：
   - 成功响应：`{ ok: true, data?: any, ... }`
   - 失败响应：`{ ok: false, error: string, code?: string }`
2. **防御性故障降级（Fail-safe）**：
   - 异步日志、异构增量同步推送等辅助旁路逻辑，必须包裹独立 `try-catch` 降级，严禁因网络波动拖垮核心业务链路（如登录、发信、订阅生成）。
3. **敏感信息脱敏**：
   - 生产环境严禁向客户端抛出数据库原始底层报错堆栈与敏感信息。

---

## 8. 测试与交付质量红线

每次引入、修改通用功能或完成微服务开发后，必须执行以下全量校验并确保 100% 通过：
1. `npm run test:kit`：验证 Kit 基础库测试（包含全页面渲染与契约断言）。
2. `npm run test:all`：执行全微服务单测、端到端集成测试、真实网络双向增量同步测试。
3. `npm run typecheck:all`：执行所有微服务及 Kit 的 TypeScript 零错误强类型校验。

---

## 9. 测试套件分类与目录结构规范 (Test Directory Categorization)

所有微服务项目 (`workers/*`) 的 `test/` 目录必须严格按测试类型分层分类治理，禁止在 `test/` 根目录下无序平铺测试文件：

```text
test/
├── helpers.ts / helpers.js       # 测试辅助工具（Mock 上下文、DB 种子、CSRF 工具等）
├── setup.ts                      # Vitest 运行时全局 Setup / Teardown 钩子
├── unit/                         # 1. 单元测试 (Unit Tests)：纯函数、加解密、协议解析器、独立处理器与插件
│   └── *.test.ts / *.test.js
├── integration/                  # 2. 集成测试 (Integration Tests)：Hono 路由端点、中间件链、D1/DO 存储、RBAC 权限
│   └── *.test.ts / *.test.js
├── e2e/                          # 3. 端到端测试 (E2E Tests)：全链路用户注册/登录/恢复、跨微服务联动调用
│   └── *.test.ts / *.test.js
└── ui/                           # 4. 前端 DOM 交互测试 (UI Tests)：页面 SSR/SPA 渲染、DOM 事件点击与状态恢复
    └── *.test.ts / *.test.js
```

1. **`test/unit/` 单元测试**：针对独立模块/纯逻辑，不依赖完整 HTTP 请求链路或复杂的全系统上下文。
2. **`test/integration/` 集成测试**：针对特定 API 路由、数据库事务、权限校验与中间件的协同逻辑。
3. **`test/e2e/` 端到端测试**：覆盖多步业务闭环（如 Passkey 初始化 $\rightarrow$ 登录 $\rightarrow$ 授权），以及微服务间互联（如 OIDC $\leftrightarrow$ Mail/Tower）。
4. **`test/ui/` 前端 DOM 测试**：针对前端页面元素存在性、按钮点击、Toast 提示、双语/主题切换、路由导航等 DOM 行为。

---

## 10. 微服务统一生产部署与发布流程规范 (Unified Production Deployment Workflow)

所有微服务项目（`oidc`, `tower`, `mail`, `push`, `flash`, `console`, `pay`, `haeo`）基于统一的 Serverless 架构体系（Cloudflare Workers + D1 + @nuln/worker-kit），**所有微服务的生产部署流程严格遵循标准五步法**：

### 10.1 标准部署五步法流水线

```text
Step 1: 基础设施配置           Step 2: 数据库初始化             Step 3: 生产密钥注入             Step 4: 服务发布上线             Step 5: 超管初始化闭环
[Cloudflare D1 / R2 / DO] ──> [wrangler d1 execute remote] ──> [wrangler secret bulk] ───> [wrangler deploy] ───────> [首访 /setup 录入 Passkey]
```

1. **Step 1: 生产基础设施前置准备 (Infrastructure Provisioning)**
   - 在 Cloudflare 控制台或通过 CLI 创建生产 D1 数据库：
     ```bash
     npx wrangler d1 create <service-db-name>
     ```
   - 将生成的 `database_id` 回填至对应微服务目录下的 `wrangler.jsonc` 中的 `d1_databases` 节点。
   - 若服务依赖 R2 存储（如 `flash`, `console`）或 Durable Objects（如 `oidc`, `console`），确保相应存储桶或类绑定已在 `wrangler.jsonc` 声明。

2. **Step 2: 生产数据库物理表结构对齐 (Schema Execution)**
   - 生产数据库建表必须使用物理 `schema.sql` 脚本，严禁在线上手工建表或修改字段：
     ```bash
     cd <service-dir>
     npx wrangler d1 execute <service-db-name> --remote --file=./schema.sql
     ```
   - 确保生产表结构与 Drizzle ORM 模型 100% 保持一致。

3. **Step 3: 生产敏感密钥与配置注入 (Secrets Provisioning)**
   - 严禁将真实生产密钥提交到 Git。在本地准备 `.dev.vars.prod`（已被 `.gitignore` 忽略）。
   - 根目录下运行批量注入指令：
     ```bash
     npm run secrets:prod:<service>   # 底层执行: wrangler secret bulk .dev.vars.prod
     ```
   - 或按需通过 CLI 单项注入：`npx wrangler secret put <SECRET_NAME>`。
   - **核心密钥对照**：
     - 通用：`COOKIE_SECRET`（会话签名密钥）。
     - OIDC：`JWT_SECRET`（Token 签名）、`ENCRYPTION_KEY`（32 字节 Hex 客户端密钥加密）。
     - Mail / Push：`RESEND_API_KEY`、`EMAIL_API_KEY`。
     - 灾备同步服务：`BACKUP_SYNC_SECRET`。

4. **Step 4: 编译打包与生产部署 (Build & Deploy)**
   - 根目录下运行对应微服务的发布指令：
     ```bash
     npm run deploy:<service>         # 例如: npm run deploy:oidc, npm run deploy:mail
     ```
   - 发布完成后，Cloudflare Workers 会自动完成全球边缘节点分发与 Routes / 自定义域名生效。

5. **Step 5: 生产首访与超级管理员 Passkey 绑定 (First-Access Admin Setup)**
   - 浏览器打开生产正式地址：`https://<domain>/<basePath>/setup`。
   - **生产脱敏铁律验证**：确认页面中管理员邮箱、姓名等所有表单项**严格留空**，无任何本地测试假数据。
   - 超级管理员现场输入真实运维邮箱与名称，点击“设置 / Setup”完成 WebAuthn / Passkey 硬件密钥注册。
   - 首个管理员创建成功后，系统自动封锁 `/setup` 接口（后续访问直接重定向或返回 403），初始化流程闭环。

---

### 10.2 微服务运维与部署命令速查表 (Workspace Cheat Sheet)

| 微服务名称 | 本地开发启动 | 本地数据库重置 | 生产密钥注入 | 生产发布上线 | 默认本地端口 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **OIDC** | `npm run dev:oidc` | `npm run init:oidc` | `npm run secrets:prod:oidc` | `npm run deploy:oidc` | `8787` |
| **Tower** | `npm run dev:tower` | `npm run init:tower` | `npm run secrets:prod:tower` | `npm run deploy:tower` | `8788` |
| **Mail** | `npm run dev:mail` | `npm run init:mail` | `npm run secrets:prod:mail` | `npm run deploy:mail` | `8789` |
| **Push** | `npm run dev:push` | `npm run init:push` | `npm run secrets:prod:push` | `npm run deploy:push` | `8790` |
| **Flash** | `npm run dev:flash` | `npm run init:flash` | `npm run secrets:prod:flash` | `npm run deploy:flash` | `8791` |
| **Console** | `npm run dev:console` | `npm run init:console` | `npm run secrets:prod:console` | `npm run deploy:console` | `8792` |
| **Pay** | `npm run dev:pay` | `npm run init:pay` | `npm run secrets:prod:pay` | `npm run deploy:pay` | `8793` |
| **Haeo** | `npm run dev:haeo` | `npm run init:haeo` | `npm run secrets:prod:haeo` | `npm run deploy:haeo` | `8794` |
| **全量/联调** | `npm run dev:services` | `npm run init:all` | - | - | - |

