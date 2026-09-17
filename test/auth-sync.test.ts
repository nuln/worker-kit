import { describe, it, expect } from "vitest";
import { AUTH_SYNC_CHANNEL, AUTH_SYNC_SCRIPT } from "../src/ui/auth-sync.js";

describe("Auth Sync Module", () => {
  it("defines standard channel and script", () => {
    expect(AUTH_SYNC_CHANNEL).toBe("nuln_auth_sync");
    expect(AUTH_SYNC_SCRIPT).toContain("BroadcastChannel");
    expect(AUTH_SYNC_SCRIPT).toContain("broadcastAuthEvent");
    expect(AUTH_SYNC_SCRIPT).toContain("__nuln_auth_sync__");
  });
});
