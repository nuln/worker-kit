import { describe, it, expect } from "vitest";
import { problemDetailsResponse, NulnErrorCode } from "../src/http/errors";

describe("@nuln/worker-kit/http/errors - problemDetailsResponse", () => {
  it("formats standard RFC 7807 problem response", async () => {
    const res = problemDetailsResponse({
      status: 400,
      title: "Bad Request",
      detail: "Invalid parameters supplied",
      code: NulnErrorCode.BAD_REQUEST,
      invalidParams: [{ name: "email", reason: "Invalid email format" }],
    });

    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toContain("application/problem+json");
    const json: any = await res.json();
    expect(json.ok).toBe(false);
    expect(json.status).toBe(400);
    expect(json.title).toBe("Bad Request");
    expect(json.detail).toBe("Invalid parameters supplied");
    expect(json.code).toBe(NulnErrorCode.BAD_REQUEST);
    expect(json["invalid-params"]).toHaveLength(1);
    expect(json["invalid-params"][0].name).toBe("email");
  });

  it("handles fallback defaults and extra context", async () => {
    const res = problemDetailsResponse({
      status: 500,
      title: "Internal Error",
      instance: "/api/pay/order_123",
      extra: { traceId: "tr-999" },
    });

    expect(res.status).toBe(500);
    const json: any = await res.json();
    expect(json.error).toBe("Internal Error");
    expect(json.type).toBe("about:blank");
    expect(json.instance).toBe("/api/pay/order_123");
    expect(json.traceId).toBe("tr-999");
  });
});
