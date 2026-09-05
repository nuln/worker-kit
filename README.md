# @nuln/worker-kit

> **Nuln 生态 Cloudflare Workers 统一开发套件**  
> 汇聚多域名动态 SSO / OIDC 规范解析、灰白极简 UI 设计系统、边缘密码学、会话管理与 HTTP 基础响应工具。

---

## 📦 模块子路径概览

| 子路径 | 功能说明 | 核心导出 |
| :--- | :--- | :--- |
| **`@nuln/worker-kit/sso`** | 多域名动态 SSO / OIDC 规范库 | `resolveOidcIssuer`, `assertSsoOrigin`, `resolveOidcRedirectUri`, `isSafeNextUrl`, `validateRedirectUri`, `selectRpId` |
| **`@nuln/worker-kit/ui`** | 灰白极简设计系统与多语言 | `DESIGN_TOKENS`, `PAGE_STYLE`, `AUTH_STYLE`, `FAVICON_TAG`, `detectLanguage`, `t` |
| **`@nuln/worker-kit/crypto`** | 边缘密码学与常量时间比对 | `sha256`, `sha256Hex`, `safeEqual`, `randomToken`, `randomB64url`, `hmacHex` |
| **`@nuln/worker-kit/session`** | 会话模型与 RFC 6265bis Cookie | `cookieAttrs`, `parseCookieValue`, `formatSessionCookie` |
| **`@nuln/worker-kit/http`** | 统一 HTTP 响应与路径清洗 | `jsonResponse`, `jsonError`, `htmlResponse`, `redirectResponse`, `normalizeBasePath`, `getClientIp` |

---

## 🚀 快速上手示例

```ts
// 在任何 Worker 项目中引入
import { resolveOidcIssuer, resolveOidcRedirectUri } from "@nuln/worker-kit/sso";
import { DESIGN_TOKENS, AUTH_STYLE } from "@nuln/worker-kit/ui";
import { sha256Hex, safeEqual } from "@nuln/worker-kit/crypto";
import { formatSessionCookie } from "@nuln/worker-kit/session";
import { jsonResponse, jsonError } from "@nuln/worker-kit/http";
```

---

## 🧪 运行测试与类型检查

```bash
npm run typecheck
npm run test
```
