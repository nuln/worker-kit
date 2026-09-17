# @nuln/worker-kit

<div align="center">

**现代、强类型、多云兼容的 Cloudflare Workers 核心通用基础库**

[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue.svg)](https://www.typescriptlang.org/)
[![Coverage](https://img.shields.io/badge/Coverage-95.01%25-brightgreen.svg)](https://vitest.dev/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

[English](./README.md) | [简体中文](./README.zh-CN.md)

</div>

---

## 📖 项目概述

`@nuln/worker-kit` 是专为 Cloudflare Workers 边缘微服务集群（`OIDC`, `Tower`, `Mail`, `Push`, `Flash`, `Console`, `Pay`, `Haeo`）设计的全栈通用基础设施库。它提供了一套无第三方冗余依赖、100% 纯 TypeScript 强类型、高覆盖率的标准化工具集，涵盖跨云对象存储、Passkey 硬件密钥认证、密码学安全、D1 增量同步与 Charcoal Slate 极简现代 UI 渲染。

---

## 📦 子包功能矩阵 (19 个模块)

| 子模块 | 引用路径 | 功能描述 |
| :--- | :--- | :--- |
| **S3** | `@nuln/worker-kit/s3` | 原生 SigV4 跨云存储客户端，全面支持 AWS S3、Cloudflare R2、MinIO、Wasabi、Backblaze B2、阿里云 OSS、腾讯云 COS。 |
| **Backup** | `@nuln/worker-kit/backup` | D1 数据库流式结构化导出、确定性 SHA-256 校验和验证与 S3 异地冷备份。 |
| **Auth** | `@nuln/worker-kit/auth` | 站点首访 Setup 初始化超级管理员锁定、Passkey 注册/登录与 Cookie 签发闭环。 |
| **WebAuthn** | `@nuln/worker-kit/webauthn` | FIDO2 Challenge 生成、多域名 RPID 解析与 Apple/YubiKey/Windows AAGUID 品牌指纹识别。 |
| **Session** | `@nuln/worker-kit/session` | RFC 6265bis HttpOnly Cookie 签名管理与 Durable Object CAS 单次安全消费会话。 |
| **SSO** | `@nuln/worker-kit/sso` | OpenID Connect (OIDC) 客户端、Discovery 配置发现、PKCE 授权码流转与 Token / UserInfo 交换。 |
| **DB** | `@nuln/worker-kit/db` | D1 智能指数退避重试引擎 (withDbRetry)，彻底消除瞬态写锁冲突。 |
| **Crypto** | `@nuln/worker-kit/crypto` | AES-GCM-256 结构化敏感数据加密、Webhook HMAC-SHA256 验签、PBKDF2 与常量时间比对。 |
| **Email** | `@nuln/worker-kit/email` | 跨环境邮件发送器（Resend、Webhook、本地控制台）与收件人清洗。 |
| **Observability** | `@nuln/worker-kit/observability`| 多探针 `/health` 端点，实时监控 D1、KV、R2 延迟与健康度量。 |
| **Middleware** | `@nuln/worker-kit/middleware` | 全链路分布式 `X-Request-ID` 追踪透传与 POST 幂等防重放缓存拦截 (withIdempotency)。 |
| **RateLimit** | `@nuln/worker-kit/ratelimit` | DO 内存亚毫秒滑动窗口计数限流器、D1 容灾降级与 IETF 标准响应头回写。 |
| **RBAC** | `@nuln/worker-kit/rbac` | 角色继承与操作权限矩阵判定 (hasPermission)。 |
| **Flags** | `@nuln/worker-kit/flags` | 动态特性开关、环境变量解析、分级内存缓存与敏感密钥脱敏展示。 |
| **URLs** | `@nuln/worker-kit/urls` | 微服务注册表解析、多域名动态 RP_ID 适配与回跳地址白名单校验。 |
| **HTTP** | `@nuln/worker-kit/http` | RFC 7807 Problem Details、客户端地理元数据提取与统一安全响应头。 |
| **Sync** | `@nuln/worker-kit/sync` | 跨微服务异步增量数据同步发射器与 LWW 冲突仲裁接收端。 |
| **UI** | `@nuln/worker-kit/ui` | Charcoal Slate 灰白极简现代 UI 页面 SSR 渲染、系统设置面板与客户端 i18n 即时生效。 |
| **PWA** | `@nuln/worker-kit/pwa` | Web App Manifest 动态生成与 PWA 安装引导响应器。 |

---

## 🚀 快速上手示例

### 1. S3 多云存储客户端调用

```ts
import { createS3Client } from "@nuln/worker-kit";

const s3 = createS3Client({
  provider: "r2",
  endpoint: "https://<account-id>.r2.cloudflarestorage.com",
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  bucket: "production-assets",
});

// 上传对象
await s3.putObject("config.json", JSON.stringify({ live: true }), {
  contentType: "application/json",
});

// 生成 1 小时有效期的预签名下载链接
const downloadUrl = await s3.getPresignedUrl("config.json", { expiresIn: 3600 });
```

### 2. Passkey 首访初始化与认证流程

```ts
import { authPageResponse, handleSetupOptions, handleSetupVerify } from "@nuln/worker-kit";

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    // 渲染初始化页面
    if (url.pathname === "/setup") {
      return authPageResponse({
        view: "setup",
        serviceName: "Tower",
        request,
        basePath: "/tower",
      });
    }

    // Passkey 挑战值生成
    if (url.pathname === "/api/setup/options" && request.method === "POST") {
      return await handleSetupOptions(request, env, {
        serviceName: "Tower",
        rpId: url.hostname,
      });
    }

    // Passkey 注册校验
    if (url.pathname === "/api/setup/verify" && request.method === "POST") {
      return await handleSetupVerify(request, env, {
        serviceName: "Tower",
        rpId: url.hostname,
        origin: url.origin,
      });
    }
  }
};
```

---

## 📚 详细开发文档

中英文双语文档均可在 `docs/` 目录下查阅：

- **[中文文档首页](./docs/zh/README.md)**
  - [S3 多云存储模块](./docs/zh/s3.md)
  - [Passkey 通行密钥与认证模块](./docs/zh/auth.md)
  - [D1 数据库与 S3 备份模块](./docs/zh/backup.md)
  - [密码学与安全模块](./docs/zh/crypto.md)
  - [幂等与全链路追踪中间件](./docs/zh/middleware.md)
- **[English Documentation](./docs/en/README.md)**
  - [S3 Storage Guide](./docs/en/s3.md)
  - [Passkey & WebAuthn Guide](./docs/en/auth.md)
  - [Database & Backups Guide](./docs/en/backup.md)
  - [Crypto & Security Guide](./docs/en/crypto.md)
  - [Idempotency & Tracing Middleware](./docs/en/middleware.md)

---

## 🛠️ 测试与质量验证

```bash
# 运行全量子模块单元测试与 19 个 Example E2E 测试
npm run test

# 运行覆盖率套件（行覆盖率 > 95%）
npm run test:coverage

# TypeScript 静态强类型检查（0 错误、0 警告）
npm run typecheck
```

---

## 📄 开源协议

MIT License © 2026 Nuln Workspace
