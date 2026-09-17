# Passkey & WebAuthn Module (`@nuln/worker-kit/auth`)

[English](./auth.md) | [简体中文](../zh/auth.md)

Provides complete hardware authentication workflows utilizing WebAuthn / FIDO2 Level 3 specifications.

## Key Capabilities

1. **First-Access Setup Protection**: Automatically detects whether any administrator credentials exist in D1.
2. **AAGUID Hardware Recognition**: Recognizes Apple Touch ID / Face ID, YubiKey 5 Series, Windows Hello TPM, and 1Password.
3. **Session Cookie Security**: Issues `__Host-` prefixed RFC 6265bis HttpOnly cookies.

## Code Example

```ts
import { handleSetupOptions, handleSetupVerify, authPageResponse } from "@nuln/worker-kit";

// Handle Setup Route
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
