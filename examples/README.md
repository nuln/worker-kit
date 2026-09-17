# @nuln/worker-kit 模块调用示例工程 (Examples Showcase)

本目录为 `@nuln/worker-kit` 旗下全部 **19 个独立子模块** 提供了标准的调用示例与架构参考，涵盖边缘无服务器环境下的存储、认证、安全、通信与 UI 渲染全生命周期。

---

## 📂 模块示例清单

| 示例文件 | 子模块 | 核心功能与应用场景 |
| :--- | :--- | :--- |
| [`01-s3-example.ts`](./01-s3-example.ts) | `s3` | 跨云 S3 (AWS/R2/Wasabi/MinIO/OSS/COS) 上传、下载、预签名 URL 生成 |
| [`02-backup-example.ts`](./02-backup-example.ts) | `backup` | D1 数据库自动化导出与 S3 异地冷备份 |
| [`03-auth-example.ts`](./03-auth-example.ts) | `auth` | 首访 Setup 初始化、Passkey 硬件认证、Cookie 签发 |
| [`04-webauthn-example.ts`](./04-webauthn-example.ts) | `webauthn` | FIDO2 Challenge 签发与 Apple/YubiKey/Windows AAGUID 品牌指纹识别 |
| [`05-session-example.ts`](./05-session-example.ts) | `session` | RFC 6265bis HttpOnly Cookie 与 Durable Object 状态会话 |
| [`06-sso-example.ts`](./06-sso-example.ts) | `sso` | OpenID Connect (OIDC) 发现端点、PKCE 与 Token 交换 |
| [`07-db-example.ts`](./07-db-example.ts) | `db` | D1 数据库智能重试策略 (withDbRetry) 与死锁自愈 |
| [`08-crypto-example.ts`](./08-crypto-example.ts) | `crypto` | AES-GCM 结构化加密、Webhook HMAC 验签与常量时间比对 |
| [`09-email-example.ts`](./09-email-example.ts) | `email` | Resend / Webhook 跨环境邮件发送与收件人清洗 |
| [`10-observability-example.ts`](./10-observability-example.ts) | `observability` | `/health` 多存储探针与就绪状态监控 |
| [`11-middleware-example.ts`](./11-middleware-example.ts) | `middleware` | POST 幂等防重放拦截器 (withIdempotency) 与全链路追踪 |
| [`12-ratelimit-example.ts`](./12-ratelimit-example.ts) | `ratelimit` | DO 内存滑动窗口计数与 IETF 响应头注入 |
| [`13-rbac-example.ts`](./13-rbac-example.ts) | `rbac` | 角色继承与权限矩阵拦截 (hasPermission) |
| [`14-flags-example.ts`](./14-flags-example.ts) | `flags` | 动态特性开关、环境变量解析与敏感密钥脱敏展示 |
| [`15-urls-example.ts`](./15-urls-example.ts) | `urls` | 微服务注册表解析与多域名动态 RP_ID 适配 |
| [`16-http-example.ts`](./16-http-example.ts) | `http` | RFC 7807 Problem Details、客户端元数据与安全响应头 |
| [`17-sync-example.ts`](./17-sync-example.ts) | `sync` | 跨节点双向增量数据同步与 LWW 冲突仲裁 |
| [`18-ui-example.ts`](./18-ui-example.ts) | `ui` | Charcoal Slate 灰白极简 UI SSR 渲染与系统设置面板 |
| [`19-pwa-example.ts`](./19-pwa-example.ts) | `pwa` | Web App Manifest 动态生成与 PWA 安装引导 |

---

## 🚀 验证与类型检查

在 `worker-kit` 根目录执行以下命令，确保所有示例与全库测试通过：

```bash
# 1. 运行所有单测、集成测试与 Example E2E 测试
npm run test

# 2. 检查全库与示例代码 100% 静态强类型规范
npm run typecheck

# 3. 生成完整代码覆盖率报告
npm run test:coverage
```
