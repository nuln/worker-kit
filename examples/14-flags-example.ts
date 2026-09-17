/**
 * Example 14: Dynamic Feature Flags & Remote Configuration
 *
 * Demonstrates:
 * 1. Defining environment configuration schema with masking
 * 2. Resolving configurations with multi-tier overrides (Memory -> Env)
 * 3. Masking sensitive secrets for admin console display
 */

import {
  resolveEnvConfigs,
  maskSecretValue,
  ConfigMemoryCache,
  type EnvConfigDefinition,
} from "@nuln/worker-kit";

export function runFeatureFlagsExample(env: any) {
  console.log("=== [Example 14] Dynamic Feature Flags & Configuration ===");

  const definitions: EnvConfigDefinition[] = [
    { key: "SITE_TITLE", name: "Site Title", description: "Display name", defaultValue: "Nuln Cloud", category: "General" },
    { key: "API_SECRET_KEY", name: "API Secret", description: "Backend secret", isSecret: true, category: "Security" },
  ];

  const configs = resolveEnvConfigs(definitions, env);
  configs.forEach((cfg) => {
    console.log(`- [${cfg.category}] ${cfg.name}: ${cfg.maskedValue} (Locked by Env: ${cfg.isLocked})`);
  });
}
