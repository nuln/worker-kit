import { describe, it, expect } from "vitest";
import {
  ICONS,
  getIcon,
  GlobeIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
  LogOutIcon,
  SettingsIcon,
} from "../src/ui/icons";
import { detectLanguage, DEFAULT_LANG } from "../src/ui/i18n";
import { DESIGN_TOKENS } from "../src/ui/styles";

describe("@nuln/worker-kit/ui/icons", () => {
  it("6 个标准图标符合 24x24 无填充 currentColor 规范", () => {
    for (const icon of [GlobeIcon, SunIcon, MoonIcon, MonitorIcon, LogOutIcon, SettingsIcon]) {
      expect(icon).toContain('viewBox="0 0 24 24"');
      expect(icon).toContain('fill="none"');
      expect(icon).toContain('stroke="currentColor"');
      expect(icon).toContain('stroke-width="2"');
    }
  });

  it("ICONS 字典 8 入口 + getIcon 回退", () => {
    expect(Object.keys(ICONS).sort()).toEqual(
      ["bell", "globe", "logout", "monitor", "moon", "settings", "sun", "user"],
    );
    expect(getIcon("globe")).toBe(GlobeIcon);
    expect(getIcon("nope")).toBe("");
  });

  it("图标不含 Emoji", () => {
    for (const v of Object.values(ICONS)) {
      expect(/[\u{1F300}-\u{1FAFF}]/u.test(v)).toBe(false);
    }
  });
});

describe("@nuln/worker-kit/ui/i18n+styles", () => {
  it("detectLanguage: query > cookie > accept-language", () => {
    expect(DEFAULT_LANG).toBe("zh");
    expect(
      detectLanguage(new Request("https://x.test/?lang=en")),
    ).toBe("en");
    expect(
      detectLanguage(
        new Request("https://x.test/", { headers: { cookie: "lang=en" } }),
      ),
    ).toBe("en");
  });

  it("DESIGN_TOKENS: 灰白极简炭黑体系（非高饱和蓝）", () => {
    expect(DESIGN_TOKENS).toContain("--bg-canvas: #f8f9fa");
    expect(DESIGN_TOKENS).toContain("--border-base: #e2e5e9");
    expect(DESIGN_TOKENS).not.toContain("#2563eb");
  });
});
