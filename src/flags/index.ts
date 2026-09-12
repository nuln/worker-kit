/**
 * @nuln/worker-kit/flags
 *
 * 边缘动态特性开关与远程配置管理套件
 * 支持：分级缓存读取（Memory Overrides -> DB/KV 缓存+TTL -> 环境变量兜底）与仪表盘敏感配置脱敏
 */

export interface EnvConfigItem {
  key: string;
  name: string;
  description: string;
  isSecret: boolean;
  isLocked: boolean;
  source: "env" | "default";
  maskedValue: string;
  value: string;
  defaultValue: string;
  category: string;
}

export interface EnvConfigDefinition {
  key: string;
  name: string;
  description: string;
  aliases?: string[];
  isSecret?: boolean;
  defaultValue?: string;
  category: string;
}

/** 检查环境变量中是否存在非空字符串配置 */
export function hasEnv(env: unknown, key: string): boolean {
  if (!env || typeof env !== "object") return false;
  const e = env as Record<string, unknown>;
  const v = e[key] ?? e[key.toLowerCase()] ?? e[key.toUpperCase()];
  return typeof v === "string" && v.trim().length > 0;
}

/** 读取环境变量中的修剪字符串值 */
export function getEnvValue(env: unknown, key: string): string | undefined {
  if (!env || typeof env !== "object") return undefined;
  const e = env as Record<string, unknown>;
  const v = e[key] ?? e[key.toLowerCase()] ?? e[key.toUpperCase()];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/** 敏感密钥脱敏展示（保留前4后4） */
export function maskSecretValue(v: string): string {
  if (!v) return "";
  if (v.length <= 8) return "••••";
  return v.slice(0, 4) + "••••" + v.slice(-4);
}

/** 批量解析定义列表与环境变量，生成前端管理面板配置元数据 */
export function resolveEnvConfigs(
  definitions: EnvConfigDefinition[],
  env: unknown,
  customOverrides?: Record<string, string | undefined>,
): EnvConfigItem[] {
  const e = env || {};
  return definitions.map((def) => {
    const allKeys = [def.key, ...(def.aliases || [])];
    let envVal: string | undefined;
    for (const k of allKeys) {
      if (hasEnv(e, k)) {
        envVal = getEnvValue(e, k);
        break;
      }
    }

    if (envVal === undefined && customOverrides && customOverrides[def.key] !== undefined) {
      envVal = customOverrides[def.key];
    }

    let source: "env" | "default" = "default";
    let effectiveValue = def.defaultValue || "";
    if (envVal !== undefined && envVal.length > 0) {
      source = "env";
      effectiveValue = envVal;
    }

    const isLocked = source === "env";
    const masked = effectiveValue
      ? def.isSecret
        ? maskSecretValue(effectiveValue)
        : effectiveValue
      : "";

    return {
      key: def.key,
      name: def.name,
      description: def.description,
      isSecret: Boolean(def.isSecret),
      isLocked,
      source,
      maskedValue: masked,
      value: def.isSecret && isLocked ? masked : effectiveValue,
      defaultValue: def.defaultValue || "",
      category: def.category,
    };
  });
}

/** 内存缓存管理器（带 TTL 与手动刷新） */
export class ConfigMemoryCache<T> {
  private cache: { value: T; expiresAt: number } | null = null;

  constructor(private ttlMs = 60_000) {}

  async getOrFetch(fetcher: () => Promise<T>, force = false): Promise<T> {
    const now = Date.now();
    if (!force && this.cache && this.cache.expiresAt > now) {
      return this.cache.value;
    }
    const val = await fetcher();
    this.cache = { value: val, expiresAt: now + this.ttlMs };
    return val;
  }

  set(val: T) {
    this.cache = { value: val, expiresAt: Date.now() + this.ttlMs };
  }

  clear() {
    this.cache = null;
  }
}
