import { describe, it, expect } from "vitest";
import {
  hasEnv,
  getEnvValue,
  maskSecretValue,
  resolveEnvConfigs,
  ConfigMemoryCache,
  type EnvConfigDefinition,
} from "../src/flags/index.js";

describe("@nuln/worker-kit/flags", () => {
  it("hasEnv & getEnvValue: 大小写不敏感检测", () => {
    const env = { my_key: "  hello world  " };
    expect(hasEnv(env, "MY_KEY")).toBe(true);
    expect(getEnvValue(env, "MY_KEY")).toBe("hello world");
    expect(hasEnv(env, "UNKNOWN")).toBe(false);
    expect(getEnvValue(env, "UNKNOWN")).toBeUndefined();
  });

  it("maskSecretValue: 掩码敏感字符串", () => {
    expect(maskSecretValue("")).toBe("");
    expect(maskSecretValue("12345678")).toBe("••••");
    expect(maskSecretValue("re_1234567890abcdef")).toBe("re_1••••cdef");
  });

  it("resolveEnvConfigs: 批量解析并脱敏", () => {
    const defs: EnvConfigDefinition[] = [
      {
        key: "API_SECRET",
        name: "Secret Key",
        description: "App secret",
        isSecret: true,
        category: "security",
      },
      {
        key: "SITE_NAME",
        name: "Site Name",
        description: "App brand",
        defaultValue: "Default App",
        category: "site",
      },
    ];

    const result = resolveEnvConfigs(defs, { API_SECRET: "sk_live_1234567890abcdef" });
    expect(result.length).toBe(2);
    expect(result[0].isLocked).toBe(true);
    expect(result[0].value).toBe("sk_l••••cdef");
    expect(result[1].source).toBe("default");
    expect(result[1].value).toBe("Default App");
  });

  it("ConfigMemoryCache: TTL 与强刷支持", async () => {
    const cache = new ConfigMemoryCache<string>(50); // 50ms TTL
    let fetchCount = 0;
    const fetcher = async () => {
      fetchCount++;
      return `val_${fetchCount}`;
    };

    const val1 = await cache.getOrFetch(fetcher);
    expect(val1).toBe("val_1");
    const val2 = await cache.getOrFetch(fetcher);
    expect(val2).toBe("val_1"); // Hit cache

    // 强刷
    const val3 = await cache.getOrFetch(fetcher, true);
    expect(val3).toBe("val_2");

    // 等待过期
    await new Promise((r) => setTimeout(r, 60));
    const val4 = await cache.getOrFetch(fetcher);
    expect(val4).toBe("val_3");
  });
});
