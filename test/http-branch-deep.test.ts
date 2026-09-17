import { describe, it, expect } from "vitest";
import {
  jsonResponse,
  jsonError,
  htmlResponse,
  textResponse,
  redirectResponse,
  normalizeBasePath,
  getClientIp,
  escapeHtml,
  formatBytes,
  errorResponse,
  applySecurityHeaders,
  createHealthResponse,
  extractClientMeta,
  parsePaginationParams,
  createDataExportResponse,
  problemDetailsResponse,
  NulnErrorCode,
} from "../src/http/index.js";

describe("HTTP Module - Deep Branch & Edge Case Coverage", () => {
  it("covers normalizeBasePath and getClientIp variations", () => {
    expect(normalizeBasePath(undefined)).toBe("");
    expect(normalizeBasePath(null)).toBe("");
    expect(normalizeBasePath("")).toBe("");
    expect(normalizeBasePath("/")).toBe("");
    expect(normalizeBasePath("///api///")).toBe("/api");
    expect(normalizeBasePath("api")).toBe("/api");

    // IP from CF-Connecting-IP
    const req1 = new Request("https://nuln.net", { headers: { "CF-Connecting-IP": "1.2.3.4" } });
    expect(getClientIp(req1)).toBe("1.2.3.4");

    // IP from X-Forwarded-For with multiple IPs
    const req2 = new Request("https://nuln.net", { headers: { "X-Forwarded-For": "5.6.7.8, 10.0.0.1" } });
    expect(getClientIp(req2)).toBe("5.6.7.8");

    // Fallback IP
    const req3 = new Request("https://nuln.net");
    expect(getClientIp(req3)).toBe("127.0.0.1");
  });

  it("covers escapeHtml and formatBytes edge cases", () => {
    expect(escapeHtml(null as any)).toBe("");
    expect(escapeHtml("<script>alert('xss' & \"test\")</script>")).toBe(
      "&lt;script&gt;alert(&#039;xss&#039; &amp; &quot;test&quot;)&lt;/script&gt;"
    );

    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024, -1)).toBe("1 KB");
    expect(formatBytes(1536, 1)).toBe("1.5 KB");
    expect(formatBytes(1048576 * 1024)).toBe("1 GB");
  });

  it("covers errorResponse and applySecurityHeaders", () => {
    const resNoDetail = errorResponse("Bad request", 400);
    expect(resNoDetail.status).toBe(400);

    const resWithDetail = errorResponse("Validation error", 422, { field: "email" });
    expect(resWithDetail.status).toBe(422);

    const headers = new Headers();
    applySecurityHeaders(headers);
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
  });

  it("covers createHealthResponse with custom version and extra fields", async () => {
    const health = createHealthResponse({
      service: "TestService",
      version: "2.5.0",
      status: "degraded",
      extra: { dbLatency: 12 },
    });
    const body = (await health.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.data.service).toBe("TestService");
    expect(body.data.version).toBe("2.5.0");
    expect(body.data.status).toBe("degraded");
    expect(body.data.dbLatency).toBe(12);

    // Default version & status
    const healthDefault = createHealthResponse({ service: "DefaultService" });
    const defaultBody = (await healthDefault.json()) as any;
    expect(defaultBody.data.version).toBe("1.0.0");
    expect(defaultBody.data.status).toBe("ok");
  });

  it("covers extractClientMeta for mobile and desktop user agents", () => {
    const desktopReq = new Request("https://nuln.net", {
      headers: {
        "CF-Connecting-IP": "100.100.100.100",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
      },
    });
    const desktopMeta = extractClientMeta(desktopReq);
    expect(desktopMeta.isMobile).toBe(false);
    expect(desktopMeta.ip).toBe("100.100.100.100");

    const mobileReq: any = new Request("https://nuln.net", {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      },
    });
    mobileReq.cf = { country: "US", city: "San Jose", asn: 13335 };
    const mobileMeta = extractClientMeta(mobileReq);
    expect(mobileMeta.isMobile).toBe(true);
    expect(mobileMeta.country).toBe("US");
    expect(mobileMeta.city).toBe("San Jose");
    expect(mobileMeta.asn).toBe(13335);
  });

  it("covers parsePaginationParams boundaries and createDataExportResponse", async () => {
    const p1 = parsePaginationParams({});
    expect(p1.page).toBe(1);
    expect(p1.limit).toBe(20);
    expect(p1.offset).toBe(0);

    const p2 = parsePaginationParams({ page: "0", limit: "999" });
    expect(p2.page).toBe(1);
    expect(p2.limit).toBe(100); // capped at 100
    expect(p2.offset).toBe(0);

    const p3 = parsePaginationParams({ page: "5", limit: "15" });
    expect(p3.page).toBe(5);
    expect(p3.limit).toBe(15);
    expect(p3.offset).toBe(60);

    const exportObj = createDataExportResponse({ items: [1, 2, 3] }, "export.json");
    expect(exportObj.headers.get("Content-Disposition")).toBe('attachment; filename="export.json"');
    expect(exportObj.headers.get("Cache-Control")).toBe("no-store");

    const exportStr = createDataExportResponse('{"raw":true}', "raw.json");
    expect(await exportStr.text()).toBe('{"raw":true}');
  });

  it("covers problemDetailsResponse with instance, invalidParams and custom extra attributes", async () => {
    const prob = problemDetailsResponse({
      status: 400,
      title: "Bad Request",
      detail: "Validation failed",
      instance: "/api/users/123",
      code: NulnErrorCode.BAD_REQUEST,
      invalidParams: [{ name: "email", reason: "is not a valid email" }],
      extra: { traceId: "tr-999" },
    });
    expect(prob.status).toBe(400);
    const body = (await prob.json()) as any;
    expect(body.instance).toBe("/api/users/123");
    expect(body["invalid-params"]).toHaveLength(1);
    expect(body.traceId).toBe("tr-999");
  });
});
