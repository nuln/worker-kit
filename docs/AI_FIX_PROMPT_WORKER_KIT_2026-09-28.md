# AI 提示词：@nuln/worker-kit 缺陷修复与工程优化任务指令

> **使用说明**：直接复制以下完整内容并发送给执行 AI。该提示词已锁定操作目录、编码规范、任务清单与验收质量门禁。

```markdown
# 任务目标：@nuln/worker-kit 缺陷修复、边界防御与工程优化

## 0. 核心角色与执行边界（Zero-Exception Mandates）
1. **工作区目录隔离红线**：
   - 本次任务**仅限在 `/Users/dukangxu/nuln/worker-kit` 目录下操作**。
   - 严禁修改外部项目（如 `workers/mail`, `workers/oidc`, `workers/tower` 等业务服务）。
2. **100% 纯 TypeScript 强类型标准**：
   - 严禁在 `src/` 或 `test/` 下引入任何 `.js` 文件。
   - 严禁使用 `@ts-ignore` 规避类型检查，必须通过正规类型收窄或泛型约束完成。
3. **向后兼容性（Backward Compatibility）**：
   - 必须完全兼容现有所有公共 API 导出，严禁对已有参数或返回值做破坏性 Breaking Change。
   - 所有新增配置项必须声明为可选属性（`optional`）并提供合理的默认值。
4. **质量门禁红线（Gate Floors）**：
   - 必须保证当前已有的 **53 个测试套件、626 项单元测试 100% 全部通过**。
   - 必须通过 `npm run test:gate`（覆盖率硬门禁：语句覆盖率 $\ge 96.1\%$，分支覆盖率 $\ge 90\%$）。
   - 必须通过 `npm run typecheck`（TypeScript 零错误、零警告）。

---

## 1. 任务清单与修复规范

请严格依据审计报告（`docs/AUDIT_AND_OPTIMIZATION_REPORT_2026-09-28.md`），按以下三批次（Batches）有序执行：

### 【第一批次：缺陷与边界隐患修复 (Bug Fixes & Hardening)】

#### 1.1 KIT-BUG-01: 通知驱动平台专用超长截断与安全降级
- **目标文件**：`src/notify/drivers/telegram.ts`, `src/notify/drivers/wecom.ts`, `src/notify/drivers/bark.ts`, `src/notify/drivers/feishu.ts`, `src/notify/security.ts`
- **要求**：
  1. 在 `security.ts` 中实现平台长度安全截断器 `truncateForPlatform(text: string, maxLength: number, suffix?: string): string`。
  2. 针对各平台硬限制进行防护（Telegram: 4096 字符, WeCom: 2048 字节, Bark: 4000 字符, Feishu: 20000 字符）。
  3. 截断时安全闭合可能被截断的 Markdown / HTML 标记，防止因标签未闭合导致平台解析 400 失败。
  4. 补充针对超长消息推送的单元测试（`test/notify-truncate.test.ts` 或在对应驱动测试中增加用例）。

#### 1.2 KIT-BUG-02: 异构 D1 增量同步网络抖动与退避容错
- **目标文件**：`src/sync/sender.ts`, `src/sync/types.ts`
- **要求**：
  1. 在 `sendD1Change` 中引入瞬时网络抖动重试机制（针对 502/503/504 与网络请求超时，默认最多重试 2 次，带退避间隔；针对 400/401/403 则立即终止）。
  2. 提供 `SyncDeliveryResult` 类型支持，并在异常时输出结构化诊断日志。
  3. 补充网络失败与重试模拟单元测试。

#### 1.3 KIT-BUG-03: S3 客户端分块上传 (Multipart Upload) 支持
- **目标文件**：`src/s3/client.ts`, `src/s3/types.ts`
- **要求**：
  1. 在 `S3Client` 中实现标准 S3 分块协议：
     - `createMultipartUpload(key: string, options?: S3PutOptions): Promise<string>` (返回 uploadId)
     - `uploadPart(key: string, uploadId: string, partNumber: number, body: ArrayBuffer | Uint8Array): Promise<{ partNumber: number; eTag: string }>`
     - `completeMultipartUpload(key: string, uploadId: string, parts: Array<{ partNumber: number; eTag: string }>): Promise<S3ObjectMetadata>`
     - `abortMultipartUpload(key: string, uploadId: string): Promise<void>`
  2. 提供分块上传辅助函数 `uploadMultipartFromChunks(...)`，支持自动分片流式上传。
  3. 在 `test/s3/` 中编写分块上传全生命周期单元测试（Mock S3 服务响应）。

#### 1.4 KIT-BUG-04: UI 认证页 CSP Nonce 动态注入支持
- **目标文件**：`src/ui/auth-pages.ts`, `src/ui/themes/modern/index.ts`, `src/ui/themes/classic/index.ts`, `src/ui/script-safety.ts`
- **要求**：
  1. 在 `AuthPageOptions` 与 `ThemeRenderOptions` 增加可选属性 `cspNonce?: string`。
  2. 渲染模板时，若 `cspNonce` 存在，在所有 `<script>` 与 `<style>` 标签上添加 `nonce="${escapeHtml(cspNonce)}"` 属性；未传入时保持现状。
  3. 补充带 CSP Nonce 与不带 CSP Nonce 的渲染断言测试。

#### 1.5 KIT-BUG-05: 客户端 Passkey 交互 In-Flight 内存防抖锁
- **目标文件**：`src/ui/themes/modern/scripts.ts`
- **要求**：
  1. 在现代主题前端注入脚本中，为 Passkey 注册/登录流程增加 `isSubmitting` 互斥防抖锁。
  2. 触发 WebAuthn 时立即禁用按钮并显示加载态；无论成功、取消或失败，在 `finally` 块中安全恢复状态，杜绝多次快速点击导致服务端 challenge 失效。
  3. 补充/更新 UI 交互测试。

---

### 【第二批次：工程优化与扩展能力 (Optimizations)】

#### 2.1 KIT-OPT-01: D1 批量增量同步与事务批处理
- **目标文件**：`src/sync/sender.ts`, `src/sync/receiver.ts`, `src/sync/types.ts`
- **要求**：
  1. 在 `sender.ts` 增加 `sendD1BatchChanges(receiverUrl: string, secret: string, changes: D1ChangeRecord[], options?: SyncOptions)`。
  2. 在 `receiver.ts` 增加 `applyD1BatchChanges(db: D1Database, payload: D1BatchSyncPayload)`，使用 `db.batch()` 事务执行变更。
  3. 补充批量同步用例与 LWW 时间戳冲突测试。

#### 2.2 KIT-OPT-02: S3 海量对象分页遍历异步生成器
- **目标文件**：`src/s3/client.ts`
- **要求**：
  1. 在 `S3Client` 中实现 `listObjectsIterator(prefix?: string, options?: ListOptions): AsyncIterable<S3Object>`。
  2. 自动透明管理 `continuationToken` 与多页流式获取。
  3. 补充异步迭代器测试用例。

#### 2.3 KIT-OPT-03: Tree-Shaking 标记
- **目标文件**：`package.json`
- **要求**：
  1. 确认并添加 `"sideEffects": false` 字段。
  2. 确保各子模块无跨域循环引用。

---

## 2. 验证与门禁执行标准

完成每批次修改后，必须在 `/Users/dukangxu/nuln/worker-kit` 目录下运行以下命令并输出验证结果：

```bash
# 1. 运行所有单元测试
npm test

# 2. 运行覆盖率硬门禁（必须 100% 达标）
npm run test:gate

# 3. TypeScript 静态类型检查（0 错误 0 警告）
npm run typecheck
```

## 3. 输出格式规范
请按照以下格式汇报执行结果：
1. **修改文件清单**（包含新增/更新的具体文件路径）。
2. **解决的任务 ID 与关键实现说明**（对应 KIT-BUG-01 ~ 05, KIT-OPT-01 ~ 03）。
3. **门禁执行结果**（粘贴 `npm test`, `npm run test:gate`, `npm run typecheck` 的运行日志）。
```
