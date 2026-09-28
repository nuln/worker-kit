import { describe, it, expect } from "vitest";
import {
  normalizeBasePath,
  stripBasePath,
  matchBasePath,
  withBasePath,
  isSafeNextUrl,
  renderBaseInjection,
} from "../../src/basepath/index.js";

describe("@nuln/worker-kit/basepath dynamic routing and path normalization matrix", () => {
  describe("normalizeBasePath", () => {
    it("returns empty string for empty, undefined, null, whitespace, or root slash", () => {
      expect(normalizeBasePath()).toBe("");
      expect(normalizeBasePath(null)).toBe("");
      expect(normalizeBasePath("")).toBe("");
      expect(normalizeBasePath("   ")).toBe("");
      expect(normalizeBasePath("/")).toBe("");
      expect(normalizeBasePath("///")).toBe("");
    });

    it("normalizes single-level subpaths with leading slash and no trailing slash", () => {
      expect(normalizeBasePath("mail")).toBe("/mail");
      expect(normalizeBasePath("/mail")).toBe("/mail");
      expect(normalizeBasePath("mail/")).toBe("/mail");
      expect(normalizeBasePath("/mail/")).toBe("/mail");
      expect(normalizeBasePath("///mail///")).toBe("/mail");
      expect(normalizeBasePath("  /tower  ")).toBe("/tower");
    });

    it("normalizes multi-level nested subpaths properly", () => {
      expect(normalizeBasePath("ops/v1/mail")).toBe("/ops/v1/mail");
      expect(normalizeBasePath("/ops/v1/mail/")).toBe("/ops/v1/mail");
      expect(normalizeBasePath("///ops///v1///mail///")).toBe("/ops///v1///mail");
    });
  });

  describe("stripBasePath", () => {
    it("returns pathname as-is if basePath is empty or falsy", () => {
      expect(stripBasePath("/api/v1/users", "")).toBe("/api/v1/users");
      expect(stripBasePath("/login", undefined)).toBe("/login");
      expect(stripBasePath("", "")).toBe("/");
    });

    it("strips exact basePath and returns root '/'", () => {
      expect(stripBasePath("/mail", "/mail")).toBe("/");
      expect(stripBasePath("/mail", "mail")).toBe("/");
      expect(stripBasePath("/tower", "/tower/")).toBe("/");
    });

    it("strips basePath from nested routes and preserves subpath starting with '/'", () => {
      expect(stripBasePath("/mail/inbox", "/mail")).toBe("/inbox");
      expect(stripBasePath("/mail/api/auth/login", "/mail")).toBe("/api/auth/login");
      expect(stripBasePath("/ops/v1/dashboard", "/ops/v1")).toBe("/dashboard");
    });

    it("does not strip if pathname only partially matches without slash boundary", () => {
      expect(stripBasePath("/mailbox", "/mail")).toBe("/mailbox");
      expect(stripBasePath("/tower-admin", "/tower")).toBe("/tower-admin");
    });
  });

  describe("matchBasePath", () => {
    it("handles root basePath deployment correctly", () => {
      const match = matchBasePath("/api/v1", "");
      expect(match.isExact).toBe(false);
      expect(match.isUnder).toBe(true);
      expect(match.shouldRedirect).toBe(false);
      expect(match.targetPath).toBe("/api/v1");
      expect(match.strippedPath).toBe("/api/v1");
    });

    it("detects exact basePath access and signals 302 trailing slash redirection", () => {
      const match = matchBasePath("/mail", "/mail");
      expect(match.isExact).toBe(true);
      expect(match.isUnder).toBe(false);
      expect(match.shouldRedirect).toBe(true);
      expect(match.targetPath).toBe("/mail/");
      expect(match.strippedPath).toBe("/");
    });

    it("detects subpath access under basePath correctly", () => {
      const match = matchBasePath("/mail/inbox", "/mail");
      expect(match.isExact).toBe(false);
      expect(match.isUnder).toBe(true);
      expect(match.shouldRedirect).toBe(false);
      expect(match.targetPath).toBe("/mail/inbox");
      expect(match.strippedPath).toBe("/inbox");
    });

    it("detects paths completely outside basePath", () => {
      const match = matchBasePath("/other/path", "/mail");
      expect(match.isExact).toBe(false);
      expect(match.isUnder).toBe(false);
      expect(match.shouldRedirect).toBe(false);
      expect(match.targetPath).toBe("/other/path");
      expect(match.strippedPath).toBe("/other/path");
    });
  });

  describe("withBasePath", () => {
    it("prepends basePath to subpaths correctly", () => {
      expect(withBasePath("/login", "/mail")).toBe("/mail/login");
      expect(withBasePath("login", "/mail")).toBe("/mail/login");
      expect(withBasePath("/", "/mail")).toBe("/mail/");
      expect(withBasePath("/api/v1", "/ops/v1")).toBe("/ops/v1/api/v1");
    });

    it("handles empty basePath gracefully", () => {
      expect(withBasePath("/login", "")).toBe("/login");
      expect(withBasePath("login", "")).toBe("/login");
      expect(withBasePath("/", "")).toBe("/");
    });
  });

  describe("isSafeNextUrl", () => {
    const origin = "https://mail.nuln.net";

    it("accepts safe in-origin URLs matching basePath", () => {
      expect(isSafeNextUrl("/mail/dashboard", origin, "/mail")).toBe(true);
      expect(isSafeNextUrl("/mail", origin, "/mail")).toBe(true);
      expect(isSafeNextUrl("/mail/", origin, "/mail")).toBe(true);
      expect(isSafeNextUrl("https://mail.nuln.net/mail/inbox", origin, "/mail")).toBe(true);
    });

    it("accepts any path if basePath is empty/root", () => {
      expect(isSafeNextUrl("/dashboard", origin, "")).toBe(true);
      expect(isSafeNextUrl("https://mail.nuln.net/settings", origin, "")).toBe(true);
    });

    it("rejects open redirect attempts and cross-origin destinations", () => {
      expect(isSafeNextUrl("https://evil.com", origin, "/mail")).toBe(false);
      expect(isSafeNextUrl("//evil.com", origin, "/mail")).toBe(false);
      expect(isSafeNextUrl("https://evil.com/mail", origin, "/mail")).toBe(false);
      expect(isSafeNextUrl("https://mail.nuln.net:8080/mail", origin, "/mail")).toBe(false);
    });

    it("rejects URLs outside of configured basePath", () => {
      expect(isSafeNextUrl("/tower/dashboard", origin, "/mail")).toBe(false);
      expect(isSafeNextUrl("/mailbox", origin, "/mail")).toBe(false);
    });

    it("rejects malicious URLs with userinfo or invalid input", () => {
      expect(isSafeNextUrl("https://user:pass@mail.nuln.net/mail", origin, "/mail")).toBe(false);
      expect(isSafeNextUrl("", origin, "/mail")).toBe(false);
      expect(isSafeNextUrl(null, origin, "/mail")).toBe(false);
    });
  });

  describe("renderBaseInjection", () => {
    it("renders <base> and window.BASE_PATH injection for subpath", () => {
      const html = renderBaseInjection("/mail");
      expect(html).toContain('<base href="/mail/">');
      expect(html).toContain('window.BASE_PATH = "mail"');
      expect(html).toContain('window.__CONFIG__.basePath = "mail"');
    });

    it("renders <base href=\"/\"> and empty BASE_PATH for root deployment", () => {
      const html = renderBaseInjection("");
      expect(html).toContain('<base href="/">');
      expect(html).toContain('window.BASE_PATH = ""');
      expect(html).toContain('window.__CONFIG__.basePath = ""');
    });
  });
});
