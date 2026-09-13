/**
 * @nuln/worker-kit/webauthn
 *
 * 边缘 Passkey / WebAuthn 核心服务端套件与 CBOR 兼容性适配层
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import {
  decodePartialCBOR,
  encodeCBOR,
  type CBORType,
} from "@levischuck/tiny-cbor";
import { fromB64url, toB64url } from "../crypto/index.js";

export {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
};

/**
 * QA-OIDC-01 compat shim: @simplewebauthn/server@13 reads the attestation
 * object map with STRING keys ('fmt'/'authData'/'attStmt'), but real CBOR
 * attestation objects use INTEGER keys (1/2/3) and @levischuck/tiny-cbor
 * preserves them as numbers — so every registration died inside
 * parseAuthenticatorData(undefined). Remap the top-level keys before handing
 * the response to verifyRegistrationResponse. Nested structures (attStmt,
 * COSE keys) are intentionally untouched: downstream code reads those with
 * numeric lookups and works correctly.
 */
export function normalizeAttestationObject(b64urlAttObj: string): string {
  let decoded: CBORType;
  try {
    const [value] = decodePartialCBOR(fromB64url(b64urlAttObj), 0);
    decoded = value;
  } catch {
    return b64urlAttObj; // let the verifier surface the proper error
  }
  if (!(decoded instanceof Map)) return b64urlAttObj;
  const m = decoded as Map<string | number, CBORType>;
  if (m.has("fmt")) return b64urlAttObj; // already normalized (forward-compat)
  if (!m.has(1) || !m.has(2) || !m.has(3)) return b64urlAttObj;
  try {
    return toB64url(
      encodeCBOR(
        new Map<string | number, CBORType>([
          ["fmt", m.get(1) as CBORType],
          ["authData", m.get(3) as CBORType],
          ["attStmt", m.get(2) as CBORType],
        ]),
      ),
    );
  } catch {
    return b64urlAttObj;
  }
}

export interface WebAuthnConfig {
  rpName: string;
  rpID: string | string[];
  origin: string | string[];
}

export function isLocalhost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  );
}

export function resolveRpID(configuredRpID: string | string[], reqHost?: string): string {
  const configuredList = (Array.isArray(configuredRpID) ? configuredRpID : [configuredRpID])
    .map((s) => s.trim())
    .filter(Boolean);
  const validConfigured = configuredList.filter(
    (id) => !id.includes("example.com") && !id.startsWith("REPLACE_"),
  );

  if (reqHost) {
    const cleanHost = reqHost.replace(/:\d+$/, "").toLowerCase();
    // 本地开发环境：浏览器严格要求 rpId 必须为 localhost 或 127.0.0.1
    if (isLocalhost(cleanHost)) {
      return cleanHost === "127.0.0.1" ? "127.0.0.1" : "localhost";
    }
    // 生产环境：若配置的 RP_ID 与当前请求 Host 匹配（或是其顶级/父级域）
    for (const id of validConfigured) {
      if (cleanHost === id || cleanHost.endsWith("." + id)) {
        return id;
      }
    }
    // 若配置的 RP_ID 无效或不匹配，则自适应当前访问的 hostname
    if (validConfigured.length === 0 || !validConfigured.some((id) => cleanHost.endsWith(id))) {
      return cleanHost;
    }
  }

  return validConfigured[0] || (reqHost ? reqHost.replace(/:\d+$/, "") : "localhost");
}

export function resolveExpectedRPIDs(configuredRpID: string | string[], reqHost?: string): string[] {
  const list = new Set<string>();
  const configuredList = Array.isArray(configuredRpID) ? configuredRpID : [configuredRpID];
  for (const id of configuredList) {
    if (id) list.add(id.trim());
  }
  if (reqHost) {
    const cleanHost = reqHost.replace(/:\d+$/, "").toLowerCase();
    list.add(cleanHost);
    if (isLocalhost(cleanHost)) {
      list.add("localhost");
      list.add("127.0.0.1");
    }
  }
  return Array.from(list);
}

export function resolveExpectedOrigins(configuredOrigin?: string | string[] | null, reqOrigin?: string): string[] {
  const list = new Set<string>();
  const rawList = Array.isArray(configuredOrigin)
    ? configuredOrigin
    : (configuredOrigin ? [configuredOrigin] : []);
  const configuredList = rawList
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const validConfigured = configuredList.filter(
    (o) => !o.includes("your-subdomain.workers.dev") && !o.includes("example.com"),
  );
  for (const o of validConfigured) {
    list.add(o);
  }
  if (reqOrigin) {
    const cleanOrigin = reqOrigin.trim().replace(/\/$/, "");
    try {
      const u = new URL(cleanOrigin);
      if (isLocalhost(u.hostname)) {
        const port = u.port ? `:${u.port}` : "";
        list.add(`http://localhost${port}`);
        list.add(`http://127.0.0.1${port}`);
        list.add(`https://localhost${port}`);
        list.add(`https://127.0.0.1${port}`);
      } else if (validConfigured.length === 0 || validConfigured.some((vo) => {
        try { return cleanOrigin === vo || u.hostname === new URL(vo).hostname || u.hostname.endsWith("." + new URL(vo).hostname); } catch { return false; }
      })) {
        list.add(cleanOrigin);
      }
    } catch (_) {}
  }
  if (list.size === 0) {
    list.add("http://localhost:8787");
    list.add("http://localhost:8799");
    list.add("http://localhost:8899");
  }
  return Array.from(list);
}

/** 容错 JSON 解析：数据库文本列若损坏，返回 undefined 而非让登录流程崩溃 */
export function safeParseTransports(
  v: string | null,
): AuthenticatorTransportFuture[] | undefined {
  if (!v) return undefined;
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed)
      ? (parsed as AuthenticatorTransportFuture[])
      : undefined;
  } catch {
    return undefined;
  }
}
