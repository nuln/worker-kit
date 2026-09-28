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

export * from "./aaguid.js";

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
export function normalizeAttestationObject(b64urlAttObj: any): any {
  if (typeof b64urlAttObj !== "string") return b64urlAttObj;
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

/**
 * 判断主机名是否为本地开发主机。
 *
 * ## 为什么不叫 isLocalhost
 *
 * `@nuln/worker-kit/ui`（`ui/auth-pages.ts`）已有一个同名的 `isLocalhost`，
 * 签名更宽（接受 `Request | string | null`）。两个同名不同签名的导出在
 * 根 barrel 平铺导出时会冲突，且调用方容易导"错"那个。本函数是 WebAuthn
 * 内部的窄版本，故独立命名为 {@link isWebAuthnLocalhost}。
 */
export function isWebAuthnLocalhost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  );
}

export function resolveRpID(configuredRpID?: string | string[] | null, reqHost?: string): string {
  const configuredList = (Array.isArray(configuredRpID)
    ? configuredRpID
    : (configuredRpID ? configuredRpID.split(",") : []))
    .map((s) => s.trim())
    .filter((s) => Boolean(s) && s !== "*");

  if (reqHost) {
    const cleanHost = reqHost.replace(/:\d+$/, "").toLowerCase();
    for (const id of configuredList) {
      if (cleanHost === id || cleanHost.endsWith("." + id)) {
        return id;
      }
    }
    // 纯数字/IP 地址按 WebAuthn 规范不能作为 rpId
    if (!/^[0-9.:[\]]+$/.test(cleanHost) && !cleanHost.includes(":")) {
      return cleanHost;
    }
  }

  return configuredList[0] || "";
}

/** 归一化 hostname：去端口、转小写。`reqHost` 可能带端口（`Host: example.com:8443`）。 */
function normalizeHostname(raw: string): string {
  return String(raw ?? "").trim().replace(/:\d+$/, "").replace(/\.$/, "").toLowerCase();
}

/** `host` 是否等于 `base`，或是 `base` 的子域（点号边界，`evil-nuln.net` 不匹配 `nuln.net`）。 */
function isSameOrSubdomain(host: string, base: string): boolean {
  if (!host || !base) return false;
  return host === base || host.endsWith("." + base);
}

/**
 * 解析期望接受的 RP ID 集合。
 *
 * ## 安全语义（务必阅读）
 *
 * RP ID 校验是 WebAuthn 反钓鱼能力的**服务端锚点**：浏览器保证 `rpId` 是调用方
 * origin 的可注册域后缀，但**服务端必须**再确认该 `rpId` 属于本部署，否则任何
 * 能把请求路由到本 Worker 的 Host 都能成为合法 RP ID。
 *
 * 因此本函数遵循两条不可退让的规则：
 *
 * 1. **未配置任何 RP ID 时返回空数组（fail-closed）**。若此时采信请求 `Host`，
 *    期望集合就等于「客户端自己说的那个值」，校验退化为恒真，形同没有校验。
 * 2. **请求 Host 只有在是某个已配置 RP ID 的子域（或相等）时才会被纳入**。
 *    这样既支持多子域部署（`auth.nuln.net` + `admin.auth.nuln.net`），
 *    又不会让 `evil.com` 混进白名单。
 *
 * @param configuredRpID 已配置的 RP ID，支持数组或逗号分隔字符串；`"*"` 视为未配置
 * @param reqHost 请求的 `Host` 头（可带端口）
 * @returns 期望 RP ID 列表；**未配置时为空数组**，交由调用方/验签库 fail-closed 报错
 */
export function resolveExpectedRPIDs(configuredRpID?: string | string[] | null, reqHost?: string): string[] {
  const list = new Set<string>();
  const rawList = Array.isArray(configuredRpID)
    ? configuredRpID
    : (configuredRpID ? configuredRpID.split(",") : []);
  for (const id of rawList) {
    if (id && typeof id === "string") {
      const clean = normalizeHostname(id);
      if (clean && clean !== "*") list.add(clean);
    }
  }

  // fail-closed：没有权威锚点就不采信任何请求派生值
  if (list.size === 0) return [];

  if (reqHost) {
    const cleanHost = normalizeHostname(reqHost);
    // 仅当请求 Host 落在已配置 RP ID 的域界内才纳入
    for (const id of list) {
      if (isSameOrSubdomain(cleanHost, id)) {
        list.add(cleanHost);
        break;
      }
    }
  }
  return Array.from(list);
}

/**
 * 解析期望接受的 Origin 集合。
 *
 * ## 安全语义（务必阅读）
 *
 * 与 {@link resolveExpectedRPIDs} 同理，Origin 校验必须 fail-closed：
 *
 * 1. **未配置（或仅配置 `"*"`）时返回空数组**。历史实现把「未配置」当作
 *    「信任一切」，会把钓鱼站自己的 Origin 加进期望列表 —— 这正是 WebAuthn
 *    origin 绑定要阻止的攻击。`"*"` 也被显式过滤，不作为通配开关。
 * 2. **请求 Origin 只有在其 hostname 是某个已配置 Origin 的子域（或相等）时
 *    才纳入**；无法解析的畸形 Origin 一律拒绝。
 * 3. 配置项统一经 `new URL(x).origin` 规范化，避免显式默认端口
 *    （`https://a.com:443`）或大小写混写导致与浏览器实际发送值永不相等。
 *
 * @param configuredOrigin 已配置 Origin，支持数组或逗号分隔字符串；`"*"` 视为未配置
 * @param reqOrigin 请求的 `Origin` 头
 * @returns 期望 Origin 列表；**未配置时为空数组**，交由调用方/验签库 fail-closed 报错
 */
export function resolveExpectedOrigins(configuredOrigin?: string | string[] | null, reqOrigin?: string): string[] {
  const list = new Set<string>();
  const rawList = Array.isArray(configuredOrigin)
    ? configuredOrigin
    : (configuredOrigin ? configuredOrigin.split(",") : []);
  const configuredList = rawList
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => Boolean(s) && s !== "*");

  // 规范化配置项，丢弃无法解析的条目
  for (const o of configuredList) {
    try {
      list.add(new URL(o).origin);
    } catch {
      // 畸形配置项：忽略（不静默放宽）
    }
  }

  // fail-closed：未配置可信 Origin 时不做任何 origin 校验放宽
  if (list.size === 0) return [];

  if (reqOrigin) {
    try {
      const u = new URL(reqOrigin.trim());
      for (const vo of list) {
        try {
          if (isSameOrSubdomain(u.hostname.toLowerCase(), new URL(vo).hostname.toLowerCase())) {
            list.add(u.origin);
            break;
          }
        } catch {
          // 单个配置项不可解析：跳过，不影响其余条目
        }
      }
    } catch {
      // 畸形 Origin 头：拒绝纳入
    }
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
