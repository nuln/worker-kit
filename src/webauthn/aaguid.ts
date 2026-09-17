/**
 * @nuln/worker-kit/webauthn/aaguid
 *
 * WebAuthn AAGUID (Authenticator Attestation GUID) 硬件感知与品牌识别引擎
 */

export interface AuthenticatorBrandInfo {
  /** 标准化 36 字符 UUID (例如: "dd48362d-0fd5-46a4-9844-486001a1d953") */
  aaguid: string;
  /** 品牌代号 */
  brand: "apple" | "google" | "microsoft" | "yubico" | "1password" | "bitwarden" | "dashlane" | "feitian" | "generic";
  /** 中文展示名称 */
  name: string;
  /** 英文展示名称 */
  nameEn: string;
  /** 图标类型 */
  iconType: "apple" | "windows" | "google" | "yubikey" | "1password" | "bitwarden" | "key" | "shield";
}

/** 知名硬件与密码管理器 AAGUID 映射表 */
const KNOWN_AAGUIDS: Record<string, Omit<AuthenticatorBrandInfo, "aaguid">> = {
  // Apple
  "00000000-0000-0000-0000-000000000000": {
    brand: "apple",
    name: "Apple 钥匙串 / 系统认证器",
    nameEn: "Apple iCloud Keychain / System Authenticator",
    iconType: "apple",
  },
  "dd48362d-0fd5-46a4-9844-486001a1d953": {
    brand: "apple",
    name: "Apple iCloud 钥匙串",
    nameEn: "Apple iCloud Keychain",
    iconType: "apple",
  },
  "df53664a-2f40-4279-8ad4-1c620406087d": {
    brand: "apple",
    name: "Apple Passkey 认证器",
    nameEn: "Apple Passkey Authenticator",
    iconType: "apple",
  },
  "b1451000-0000-0000-0000-000000000000": {
    brand: "apple",
    name: "Apple 触控 ID (Touch ID)",
    nameEn: "Apple Touch ID",
    iconType: "apple",
  },

  // Microsoft / Windows Hello
  "08987058-cadc-4b81-b6e1-30de50dcbe96": {
    brand: "microsoft",
    name: "Windows Hello 软件凭据",
    nameEn: "Windows Hello Software",
    iconType: "windows",
  },
  "6028b012-b052-4a08-8316-728419bc4f31": {
    brand: "microsoft",
    name: "Windows Hello TPM 硬件芯片",
    nameEn: "Windows Hello TPM Hardware",
    iconType: "windows",
  },
  "9ed19379-30c2-4ebf-80d2-4309ba8cf261": {
    brand: "microsoft",
    name: "Windows Hello 硬件认证器",
    nameEn: "Windows Hello Authenticator",
    iconType: "windows",
  },

  // Google
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": {
    brand: "google",
    name: "Google 密码管理器 (Android)",
    nameEn: "Google Password Manager (Android)",
    iconType: "google",
  },
  "ad593736-de3c-4450-9602-53fe590e816a": {
    brand: "google",
    name: "Google Play 服务凭据",
    nameEn: "Google Play Services",
    iconType: "google",
  },
  "00000000-0000-0000-0000-000000000001": {
    brand: "google",
    name: "Google Chrome 密码管理器",
    nameEn: "Google Chrome Password Manager",
    iconType: "google",
  },

  // Yubico / YubiKey
  "ee882879-721c-4916-ad96-be05544e98fb": {
    brand: "yubico",
    name: "YubiKey 5 系列硬件密钥",
    nameEn: "YubiKey 5 Series",
    iconType: "yubikey",
  },
  "cb69481e-8ff7-4039-93ec-0a2729a1d67b": {
    brand: "yubico",
    name: "YubiKey 5 NFC",
    nameEn: "YubiKey 5 NFC",
    iconType: "yubikey",
  },
  "2fc0579f-8113-47ea-b116-e82db754b582": {
    brand: "yubico",
    name: "YubiKey 5Ci",
    nameEn: "YubiKey 5Ci",
    iconType: "yubikey",
  },
  "b92d3f9b-6f09-42b6-ab5d-bd0d3aab711a": {
    brand: "yubico",
    name: "YubiKey Bio 指纹安全密钥",
    nameEn: "YubiKey Bio",
    iconType: "yubikey",
  },
  "fa2b99dc-9e39-4257-8f92-4a30d23c4118": {
    brand: "yubico",
    name: "YubiKey 5 FIPS 级安全密钥",
    nameEn: "YubiKey 5 FIPS",
    iconType: "yubikey",
  },
  "c13c95a8-1f6b-4f9f-bb2a-7e6141a0e9a5": {
    brand: "yubico",
    name: "Security Key by Yubico",
    nameEn: "Security Key by Yubico",
    iconType: "yubikey",
  },

  // 1Password
  "b5397666-4885-aa6b-1514-46ba006b5397": {
    brand: "1password",
    name: "1Password 通行密钥",
    nameEn: "1Password Passkey",
    iconType: "1password",
  },

  // Bitwarden
  "6dc21124-766f-4740-b6f7-b863d043eb7e": {
    brand: "bitwarden",
    name: "Bitwarden 密码管理器",
    nameEn: "Bitwarden Passkey",
    iconType: "bitwarden",
  },
  "6dc21124-766f-4740-b6f7-b863d043eb7f": {
    brand: "bitwarden",
    name: "Bitwarden 密码管理器",
    nameEn: "Bitwarden Passkey",
    iconType: "bitwarden",
  },

  // Dashlane
  "32f7a42b-b6d9-4b68-b7a4-a953e5e4d2a1": {
    brand: "dashlane",
    name: "Dashlane 密码管理器",
    nameEn: "Dashlane Passkey",
    iconType: "shield",
  },

  // Feitian
  "00000000-c000-0000-0000-000000000000": {
    brand: "feitian",
    name: "飞天诚信 ePass 硬件密钥",
    nameEn: "Feitian ePass Security Key",
    iconType: "key",
  },
  "14944405-b500-4cb7-8468-31d92617f484": {
    brand: "feitian",
    name: "飞天诚信 BioPass 生物识别密钥",
    nameEn: "Feitian BioPass Security Key",
    iconType: "key",
  },
};

/**
 * 将任意格式的 AAGUID（16 字节 Uint8Array、Base64url、或已有的 UUID 字符串）统一格式化为小写 36 字符 UUID
 */
export function normalizeAaguid(raw: string | Uint8Array | null | undefined): string {
  if (!raw) return "00000000-0000-0000-0000-000000000000";

  if (typeof raw === "string") {
    const trimmed = raw.trim().toLowerCase();
    // 已经是符合 UUID 标准的 8-4-4-4-12 格式
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(trimmed)) {
      return trimmed;
    }
    // 32 位无连字符 hex 字符串
    if (/^[0-9a-f]{32}$/.test(trimmed)) {
      return `${trimmed.slice(0, 8)}-${trimmed.slice(8, 12)}-${trimmed.slice(12, 16)}-${trimmed.slice(16, 20)}-${trimmed.slice(20, 32)}`;
    }
    // 尝试 base64 / base64url 解析
    try {
      const b64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
      const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
      const bin = atob(b64 + pad);
      if (bin.length === 16) {
        const bytes = new Uint8Array(16);
        for (let i = 0; i < 16; i++) bytes[i] = bin.charCodeAt(i);
        return formatAaguidFromBytes(bytes);
      }
    } catch {
      // 无法解析时返回全 0
    }
    return "00000000-0000-0000-0000-000000000000";
  }

  if (raw instanceof Uint8Array && raw.length === 16) {
    return formatAaguidFromBytes(raw);
  }

  return "00000000-0000-0000-0000-000000000000";
}

function formatAaguidFromBytes(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`.toLowerCase();
}

/**
 * 根据 AAGUID 解析认证器的硬件品牌与显示名称
 */
export function resolveAAGUID(rawAaguid: string | Uint8Array | null | undefined): AuthenticatorBrandInfo {
  const norm = normalizeAaguid(rawAaguid);
  const found = KNOWN_AAGUIDS[norm];
  if (found) {
    return {
      aaguid: norm,
      ...found,
    };
  }

  return {
    aaguid: norm,
    brand: "generic",
    name: "通用安全通行密钥",
    nameEn: "Generic Security Passkey",
    iconType: "key",
  };
}
