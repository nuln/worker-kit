# @nuln/worker-kit

<div align="center">

**Modern, Type-Safe, Multi-Cloud Serverless Utilities for Cloudflare Workers**

[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue.svg)](https://www.typescriptlang.org/)
[![Coverage](https://img.shields.io/badge/Coverage-95.01%25-brightgreen.svg)](https://vitest.dev/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

[English](./README.md) | [简体中文](./README.zh-CN.md)

</div>

---

## 📖 Overview

`@nuln/worker-kit` is the foundational multi-cloud serverless toolkit designed for high-performance Cloudflare Workers microservices (`OIDC`, `Tower`, `Mail`, `Push`, `Flash`, `Console`, `Pay`, `Haeo`). It provides standardized, zero-dependency, type-safe abstractions for storage, authentication, cryptography, distributed sessions, UI rendering, and observability.

---

## 📦 Submodules Matrix (19 Packages)

| Submodule | Import Path | Description |
| :--- | :--- | :--- |
| **S3** | `@nuln/worker-kit/s3` | Universal S3 Client supporting AWS S3, Cloudflare R2, MinIO, Wasabi, Backblaze B2, Alibaba OSS, and Tencent COS. |
| **Backup** | `@nuln/worker-kit/backup` | Automated D1 database streaming snapshots, SHA-256 integrity verification, and cold S3 archival. |
| **Auth** | `@nuln/worker-kit/auth` | Complete Passkey setup, WebAuthn verification, and session management flow. |
| **WebAuthn** | `@nuln/worker-kit/webauthn` | FIDO2 challenge generation, multi-origin resolution, and hardware AAGUID brand fingerprinting (Apple, YubiKey, Windows Hello, 1Password). |
| **Session** | `@nuln/worker-kit/session` | RFC 6265bis HttpOnly Cookie management and Durable Object Compare-And-Swap (CAS) stateful sessions. |
| **SSO** | `@nuln/worker-kit/sso` | OpenID Connect (OIDC) client, discovery document parser, PKCE (S256), and Token / UserInfo exchange. |
| **DB** | `@nuln/worker-kit/db` | Exponential backoff query retry engine for Cloudflare D1 to eliminate transient write locks. |
| **Crypto** | `@nuln/worker-kit/crypto` | AES-GCM-256 JSON encryption, HMAC-SHA256 signature verification, PBKDF2 password hashing, and constant-time string comparison. |
| **Email** | `@nuln/worker-kit/email` | Multi-environment email dispatching (Resend, Webhook, Console) and recipient address sanitization. |
| **Observability** | `@nuln/worker-kit/observability`| Multi-probe `/health` check handler measuring D1, KV, R2 latency and readiness. |
| **Middleware** | `@nuln/worker-kit/middleware` | Distributed `X-Request-ID` tracing propagation and POST `Idempotency-Key` deduplication cache. |
| **RateLimit** | `@nuln/worker-kit/ratelimit` | Durable Object in-memory sub-millisecond sliding window rate limiting with D1 fallback and IETF headers. |
| **RBAC** | `@nuln/worker-kit/rbac` | Hierarchical role-based access control matrix with role inheritance. |
| **Flags** | `@nuln/worker-kit/flags` | Dynamic environment configuration resolver with tiered memory caching and sensitive secret masking. |
| **URLs** | `@nuln/worker-kit/urls` | Multi-domain dynamic OIDC issuer resolution and redirect URI validation. |
| **HTTP** | `@nuln/worker-kit/http` | RFC 7807 Problem Details, client metadata parsing, and standardized JSON/HTML responses. |
| **Sync** | `@nuln/worker-kit/sync` | Asynchronous multi-node D1 incremental sync with Last-Write-Wins (LWW) conflict resolution. |
| **UI** | `@nuln/worker-kit/ui` | Charcoal Slate minimalist UI SSR rendering, topbar actions, settings modal, and client-side i18n switcher. |
| **PWA** | `@nuln/worker-kit/pwa` | Dynamic Web App Manifest generator and installation response helper. |

---

## 🚀 Quick Start

### 1. Universal S3 Multi-Cloud Storage

```ts
import { createS3Client } from "@nuln/worker-kit";

const s3 = createS3Client({
  provider: "r2",
  endpoint: "https://<account-id>.r2.cloudflarestorage.com",
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  bucket: "production-assets",
});

// Upload
await s3.putObject("config.json", JSON.stringify({ live: true }), {
  contentType: "application/json",
});

// Generate Presigned Download URL
const downloadUrl = await s3.getPresignedUrl("config.json", { expiresIn: 3600 });
```

### 2. Passkey Setup & Authentication

```ts
import { authPageResponse, handleSetupOptions, handleSetupVerify } from "@nuln/worker-kit";

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    // Render Setup SSR Page
    if (url.pathname === "/setup") {
      return authPageResponse({
        view: "setup",
        serviceName: "Tower",
        request,
        basePath: "/tower",
      });
    }

    // WebAuthn Challenge
    if (url.pathname === "/api/setup/options" && request.method === "POST") {
      return await handleSetupOptions(request, env, {
        serviceName: "Tower",
        rpId: url.hostname,
      });
    }

    // WebAuthn Verification
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

### 3. Rate Limiting with Durable Object & D1 Fallback

```ts
import { RateLimitService, applyRateLimitHeaders } from "@nuln/worker-kit";

const limiter = new RateLimitService(env.DB, env.RATE_LIMITER_DO);
const result = await limiter.consume(`ip:${clientIp}`, 60, 60);

const headers = new Headers();
applyRateLimitHeaders(headers, result);

if (!result.ok) {
  return new Response("Rate limit exceeded", { status: 429, headers });
}
```

---

## 📚 Detailed Documentation

Detailed guides and API specifications are available for both English and Chinese:

- **[English Documentation](./docs/en/README.md)**
  - [S3 Storage Guide](./docs/en/s3.md)
  - [Passkey & WebAuthn Guide](./docs/en/auth.md)
  - [Database & Backups Guide](./docs/en/backup.md)
  - [Crypto & Security Guide](./docs/en/crypto.md)
  - [Idempotency & Tracing Middleware](./docs/en/middleware.md)
- **[中文开发文档](./docs/zh/README.md)**
  - [S3 多云存储模块](./docs/zh/s3.md)
  - [Passkey 通行密钥与认证模块](./docs/zh/auth.md)
  - [D1 数据库与 S3 备份模块](./docs/zh/backup.md)
  - [密码学与安全模块](./docs/zh/crypto.md)
  - [幂等与全链路追踪中间件](./docs/zh/middleware.md)

---

## 🛠️ Testing & Verification

```bash
# Run all unit tests, integration tests, and 19 Example E2E tests
npm run test

# Run test coverage suite (>95% line coverage)
npm run test:coverage

# TypeScript Typecheck (0 warnings, 0 errors)
npm run typecheck
```

---

## 📄 License

MIT License © 2026 Nuln Workspace
