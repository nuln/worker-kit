import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // AGENTS §9：测试必须按类型分层，禁止在 test/ 根目录平铺
    include: [
      "test/unit/**/*.test.ts",
      "test/integration/**/*.test.ts",
      "test/e2e/**/*.test.ts",
      "test/ui/**/*.test.ts",
    ],
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      // json reporter 是必需的：test/unit/coverage-floor-gate.test.ts
      // 读 coverage/coverage-final.json 判定每文件覆盖率下限。
      // 去掉它 → 门禁被静默跳过 → 覆盖率下限形同虚设。
      reporter: ["text", "json-summary", "json"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
    },
  },
});
