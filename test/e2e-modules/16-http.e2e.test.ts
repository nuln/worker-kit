import { describe, it, expect } from "vitest";
import {
  jsonResponse,
  jsonError,
  htmlResponse,
  textResponse,
  redirectResponse,
  getClientIp,
  extractClientMeta,
  parsePaginationParams,
  formatBytes,
  problemDetailsResponse,
  NulnErrorCode,
} from "../../src/http/index.js";

describe("[E2E Example] 16 - Unified HTTP Responses & Standard Exception Hierarchy", () => {
  it("formats standardized JSON contracts, handles redirects, problem details, and client metadata", async () => {
    // 1. Success Responses
    const resOk = jsonResponse({ ok: true, data: { user: "alice", role: "admin" } });
    expect(resOk.status).toBe(200);
    const bodyOk = (await resOk.json()) as any;
    expect(bodyOk.ok).toBe(true);
    expect(bodyOk.data.user).toBe("alice");

    // 2. Error Response format
    const resErr = jsonError(401, "Invalid credentials", "INVALID_CREDENTIALS");
    expect(resErr.status).toBe(401);
    const bodyErr = (await resErr.json()) as any;
    expect(bodyErr.ok).toBe(false);
    expect(bodyErr.error).toBe("Invalid credentials");
    expect(bodyErr.code).toBe("INVALID_CREDENTIALS");

    // 3. HTML, Plaintext & Redirect Responses
    const resHtml = htmlResponse("<h1>Welcome</h1>");
    expect(resHtml.headers.get("Content-Type")).toContain("text/html");

    const resText = textResponse(200, "plain text message");
    expect(resText.headers.get("Content-Type")).toContain("text/plain");

    const resRedir = redirectResponse("https://nuln.net/login", 302);
    expect(resRedir.headers.get("Location")).toBe("https://nuln.net/login");

    // 4. RFC 7807 Problem Details Response
    const problemRes = problemDetailsResponse({
      status: 404,
      title: "Resource Not Found",
      detail: "The requested user ID does not exist.",
      code: NulnErrorCode.NOT_FOUND,
      invalidParams: [{ name: "userId", reason: "must be a valid UUID" }],
    });
    expect(problemRes.status).toBe(404);
    expect(problemRes.headers.get("Content-Type")).toContain("application/problem+json");
    const problemBody = (await problemRes.json()) as any;
    expect(problemBody.code).toBe("ERR_NOT_FOUND");
    expect(problemBody["invalid-params"][0].name).toBe("userId");

    // 5. Client Metadata & IP Extraction
    const req = new Request("https://nuln.net/api/items?page=2&limit=25", {
      headers: {
        "CF-Connecting-IP": "203.0.113.195",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)",
      },
    });
    const ip = getClientIp(req);
    expect(ip).toBe("203.0.113.195");

    const meta = extractClientMeta(req);
    expect(meta.ip).toBe("203.0.113.195");
    expect(meta.isMobile).toBe(true);

    // 6. Pagination & Utility helpers
    const pagination = parsePaginationParams({ page: "3", limit: "20" });
    expect(pagination.page).toBe(3);
    expect(pagination.limit).toBe(20);
    expect(pagination.offset).toBe(40);

    expect(formatBytes(1048576)).toBe("1 MB");
  });
});

