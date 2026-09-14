import { describe, it, expect } from "vitest";
import {
  jsonResponse,
  jsonError,
  htmlResponse,
  textResponse,
  redirectResponse,
  normalizeBasePath,
  getClientIp,
  extractClientMeta,
  parsePaginationParams,
  createDataExportResponse,
} from "../src/http/index";

describe("@nuln/worker-kit/http", () => {
  it("jsonResponse: JSON 载荷 + 状态码 + 合并头", async () => {
    const res = jsonResponse({ a: 1 }, 201, { "X-Test": "1" });
    expect(res.status).toBe(201);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("X-Test")).toBe("1");
    expect(await res.json()).toEqual({ a: 1 });
  });

  it("jsonError: 标准失败外壳 ok:false", async () => {
    const res = jsonError(400, "bad input");
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.error).toBe("bad input");
    expect(body.code).toBe("HTTP_400");
  });

  it("jsonError: 支持自定义 code 与 extra", async () => {
    const res = jsonError(401, "unauthorized", "AUTH_REQUIRED", { retry: true });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("AUTH_REQUIRED");
    expect(body.retry).toBe(true);
  });

  it("htmlResponse / textResponse: 正确的 Content-Type", async () => {
    expect((await htmlResponse("<p>x</p>").text())).toBe("<p>x</p>");
    const t = textResponse(200, "ok");
    expect(t.headers.get("Content-Type")).toContain("text/plain");
  });

  it("redirectResponse: Location 头与状态码", () => {
    const res = redirectResponse("/login", 302);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
  });

  it("normalizeBasePath: 空/根/缺斜杠归一", () => {
    expect(normalizeBasePath(undefined)).toBe("");
    expect(normalizeBasePath("/")).toBe("");
    expect(normalizeBasePath("oidc")).toBe("/oidc");
    expect(normalizeBasePath("/oidc/")).toBe("/oidc");
  });

  it("getClientIp: CF 头优先，其次 XFF", () => {
    const cf = new Request("https://x.test/", {
      headers: { "CF-Connecting-IP": "1.2.3.4" },
    });
    expect(getClientIp(cf)).toBe("1.2.3.4");
    const xff = new Request("https://x.test/", {
      headers: { "X-Forwarded-For": "5.6.7.8, 9.9.9.9" },
    });
    expect(getClientIp(xff)).toBe("5.6.7.8");
    expect(getClientIp(new Request("https://x.test/"))).toBe("127.0.0.1");
  });

  it("extractClientMeta / parsePaginationParams / createDataExportResponse", () => {
    const req = new Request("https://x.test/api", {
      headers: { "CF-Connecting-IP": "8.8.8.8", "User-Agent": "Mozilla/5.0 iPhone" },
    });
    const meta = extractClientMeta(req);
    expect(meta.ip).toBe("8.8.8.8");
    expect(meta.isMobile).toBe(true);

    const p1 = parsePaginationParams({ page: "2", limit: "50" });
    expect(p1).toEqual({ page: 2, limit: 50, offset: 50 });

    const pDefault = parsePaginationParams({});
    expect(pDefault).toEqual({ page: 1, limit: 20, offset: 0 });

    const exportRes = createDataExportResponse({ foo: "bar" }, "export.json");
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get("Content-Disposition")).toContain("export.json");
  });
});
