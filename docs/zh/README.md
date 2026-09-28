# @nuln/worker-kit 中文开发文档

欢迎查阅 `@nuln/worker-kit` 核心架构与各子模块详细技术指引。

[English](../en/README.md) | [简体中文](./README.md)

---

## 📑 模块开发指引

> 下列条目**只列出已有文档的模块**。其余模块请直接阅读源码，其导出符号均有
> 完整 TSDoc（`@param` / `@returns` / `@throws` / 安全语义说明），并可用
> `examples/` 下的 21 个可编译示例作为参考 —— `npm run typecheck` 会把示例
> 一起检查，示例与实现不会失配。

1. **[S3 跨云对象存储模块](./s3.md)**：原生 SigV4 签名客户端，支持 AWS、R2、MinIO、Wasabi、B2、OSS、COS。
2. **[Passkey 与 WebAuthn 认证模块](./auth.md)**：硬件生物识别认证、站点首访初始化与会话生命周期。
3. **[D1 数据库与 S3 异地备份模块](./backup.md)**：D1 数据库快照、SHA-256 完整性断言与定时轮转清理。
4. **[部署预检与初始化前置检查](./config.md)**：secret / binding / var 缺失即报错；`/setup` 页在缺配置时显示「需要配置什么」。需求为纯数据，加环境变量不改代码。

### 尚未撰写独立文档的模块

以下模块**没有**对应的 `docs/` 文件（源码 TSDoc 完整）：
`crypto`、`middleware`、`ratelimit`、`ui`、`sync`、`db`、`dns`、`email`、
`flags`、`http`、`observability`、`pwa`、`rbac`、`urls`、`webauthn`、`notify`、
`basepath`、`conventions`。

补写时请勿在索引中先列出尚未创建的文件 —— 索引与实际文件不一致本身就是
需要避免的文档失真。
