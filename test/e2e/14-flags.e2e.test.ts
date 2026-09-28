import { describe, it, expect } from "vitest";
import {
  resolveEnvConfigs,
  maskSecretValue,
  ConfigMemoryCache,
  hasEnv,
  getEnvValue,
  type EnvConfigDefinition,
} from "../../src/flags/index.js";

describe("[E2E Example] 14 - Dynamic Remote Configuration & Sensitive Field Masking", () => {
  it("orchestrates environment resolution, secret masking, and TTL memory caching", async () => {
    const definitions: EnvConfigDefinition[] = [
      {
        key: "APP_NAME",
        name: "Application Name",
        description: "Public name",
        defaultValue: "DefaultApp",
        category: "general",
      },
      {
        key: "DATABASE_PASSWORD",
        name: "Database Password",
        description: "DB password",
        isSecret: true,
        defaultValue: "default_secret",
        category: "security",
      },
    ];

    const mockEnv = {
      APP_NAME: "Nuln Suite",
      DATABASE_PASSWORD: "super_secret_db_password_12345",
    };

    // 1. Resolve configs from env
    const configs = resolveEnvConfigs(definitions, mockEnv);
    expect(configs.length).toBe(2);

    const appConfig = configs.find((c) => c.key === "APP_NAME");
    expect(appConfig?.value).toBe("Nuln Suite");
    expect(appConfig?.source).toBe("env");

    const dbConfig = configs.find((c) => c.key === "DATABASE_PASSWORD");
    expect(dbConfig?.isSecret).toBe(true);
    expect(dbConfig?.isLocked).toBe(true);
    expect(dbConfig?.maskedValue).toContain("••••");

    // 2. Secret Masking
    expect(maskSecretValue("short")).toBe("••••");
    expect(maskSecretValue("sk-1234567890abcdef")).toBe("sk-1••••cdef");

    // 3. Env helpers
    expect(hasEnv(mockEnv, "APP_NAME")).toBe(true);
    expect(getEnvValue(mockEnv, "APP_NAME")).toBe("Nuln Suite");

    // 4. Config Memory Cache with TTL
    let fetchCount = 0;
    const cache = new ConfigMemoryCache<string>(50);
    const fetcher = async () => {
      fetchCount++;
      return "cached_remote_val";
    };

    const val1 = await cache.getOrFetch(fetcher);
    expect(val1).toBe("cached_remote_val");
    expect(fetchCount).toBe(1);

    const val2 = await cache.getOrFetch(fetcher);
    expect(val2).toBe("cached_remote_val");
    expect(fetchCount).toBe(1); // Cached
  });
});
