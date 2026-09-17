# @nuln/worker-kit 中文开发文档

欢迎查阅 `@nuln/worker-kit` 核心架构与各子模块详细技术指引。

[English](../en/README.md) | [简体中文](./README.md)

---

## 📑 模块开发指引

1. **[S3 跨云对象存储模块](./s3.md)**：原生 SigV4 签名客户端，支持 AWS、R2、MinIO、Wasabi、B2、OSS、COS。
2. **[Passkey 与 WebAuthn 认证模块](./auth.md)**：硬件生物识别认证、站点首访初始化与会话生命周期。
3. **[D1 数据库与 S3 异地备份模块](./backup.md)**：D1 数据库快照、SHA-256 完整性断言与定时轮转清理。
4. **[零信任密码学模块](./crypto.md)**：AES-GCM-256 结构化加密、Webhook HMAC 验签与防时序侧信道比对。
5. **[网关中间件：全链路追踪与幂等防护](./middleware.md)**：`X-Request-ID` 透传与 POST 幂等防重放。
6. **[滑动窗口限流器](./ratelimit.md)**：Durable Object 内存亚毫秒计数与 D1 容灾降级。
7. **[Charcoal Slate UI SSR 与多语言](./ui.md)**：Charcoal Slate 极简视觉、系统设置面板与客户端 i18n 即时切换。
8. **[多节点增量数据同步](./sync.md)**：跨微服务异步增量同步与 LWW 毫秒级时间戳仲裁。
