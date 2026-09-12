import { describe, it, expect } from "vitest";
import {
  lookupZone,
  getDnsSetupInstructions,
  verifyDnsViaDoH,
  DEFAULT_EMAIL_ROUTING_RECORDS,
} from "../src/dns/index.js";

describe("@nuln/worker-kit/dns", () => {
  it("lookupZone: Mock 模式", async () => {
    const zone = await lookupZone("", "example.com", true);
    expect(zone.id).toBe("mock_zone_id");
    expect(zone.name).toBe("example.com");
  });

  it("getDnsSetupInstructions: 说明文本生成", () => {
    const text = getDnsSetupInstructions("mail.nuln.dev", DEFAULT_EMAIL_ROUTING_RECORDS);
    expect(text).toContain("mail.nuln.dev");
    expect(text).toContain("mx.cloudflare.net");
    expect(text).toContain("v=spf1");
  });

  it("verifyDnsViaDoH: 本地回环 Mock 检测", async () => {
    const res = await verifyDnsViaDoH("localhost", DEFAULT_EMAIL_ROUTING_RECORDS, true);
    expect(res.configured).toBe(true);
    expect(res.method).toBe("mock");
    expect(res.records.length).toBe(2);
  });
});
