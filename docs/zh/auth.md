# Passkey 与 WebAuthn 认证模块 (`@nuln/worker-kit/auth`)

[English](../en/auth.md) | [简体中文](./auth.md)

提供符合 FIDO2 / WebAuthn Level 3 标准的端到端硬件通行密钥认证工作流。

## 核心特性

1. **首访初始化安全封锁**：自动探测 D1 是否存在已绑定的超级管理员凭据，未初始化时引导首访注册，初始化后自动封锁接口。
2. **AAGUID 硬件品牌识别**：自动识别 Apple 钥匙串、Touch ID、YubiKey 5 系列、Windows Hello TPM 芯片与 1Password 密码管理器。
3. **Session Cookie 安全基线**：自动声明 `HttpOnly; Path=/; SameSite=Lax` 与 `Secure` 属性。

## 代码示例

```ts
import { handleSetupOptions, handleSetupVerify, authPageResponse } from "@nuln/worker-kit";

export async function handleSetup(request: Request, env: any) {
  if (request.method === "GET") {
    return authPageResponse({
      view: "setup",
      serviceName: "Tower",
      request,
      basePath: "/tower",
    });
  }
}
```
