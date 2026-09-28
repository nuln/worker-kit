/**
 * WebAuthn / i18n / crypto / observability 的分支补齐
 *
 * 这几处的共同点：未覆盖分支集中在「输入缺省」与「类型兜底」上。
 * 看似琐碎，但 WebAuthn 的 RP-ID 推导与 crypto 的类型判定一旦退化，
 * 表现是"某些客户端莫名验签失败"或"二进制数据被当成字符串处理"。
 */

import { describe, it, expect } from "vitest";
import {
  normalizeAttestationObject,
  isWebAuthnLocalhost,
  resolveRpID,
  resolveExpectedRPIDs,
  resolveExpectedOrigins,
  safeParseTransports,
} from "../../src/webauthn/index.js";
import { detectLanguage, handleLangParam, getAuthI18n, i18nAssignment } from "../../src/ui/i18n.js";
import {
  sha256,
  sha256Hex,
  safeEqual,
  generateId,
  deriveKey,
  encryptJson,
  decryptJson,
  encryptSecret,
  decryptSecret,
  hashPassword,
  verifyPassword,
} from "../../src/crypto/index.js";

/* ==================================================== WebAuthn */

describe("normalizeAttestationObject", () => {
  it("Uint8Array 原样返回", () => {
    const b = new Uint8Array([1, 2, 3]);
    expect(normalizeAttestationObject(b)).toBe(b);
  });
  it("无法解成 attestation CBOR Map 的字符串原样返回（交由验签器报错）", () => {
    // 该函数只把**已规范化的 attestation**（带 1/2/3 键的 CBOR Map）转成对象；
    // 其余一律原样返回，避免在这里吞掉真实错误。
    expect(normalizeAttestationObject("_w")).toBe("_w");
  });
  it("null / undefined 原样返回", () => {
    expect(normalizeAttestationObject(null)).toBeNull();
    expect(normalizeAttestationObject(undefined)).toBeUndefined();
  });
  it("非 base64url 的字符串原样返回（不得吞成空）", () => {
    expect(normalizeAttestationObject("!!!not-base64!!!")).toBe("!!!not-base64!!!");
  });
  it("普通对象原样返回", () => {
    const o = { a: 1 };
    expect(normalizeAttestationObject(o)).toBe(o);
  });
});

describe("isWebAuthnLocalhost", () => {
  it("识别 localhost / 127.0.0.1 / [::1] / *.localhost / *.local", () => {
    // 注意：只认精确的 127.0.0.1（不是整个 127/8），[::1] 必须带方括号
    for (const h of ["localhost", "127.0.0.1", "[::1]", "app.localhost", "x.local"]) {
      expect(isWebAuthnLocalhost(h), `${h} 应被识别为本地`).toBe(true);
    }
  });
  it("不带方括号的 ::1 不算（与实际 Origin 头格式一致）", () => {
    expect(isWebAuthnLocalhost("::1")).toBe(false);
  });
  it("拒绝公网 host", () => {
    expect(isWebAuthnLocalhost("a.com")).toBe(false);
  });
  it("空值不抛错", () => {
    expect(() => isWebAuthnLocalhost("")).not.toThrow();
  });
});

describe("resolveRpID", () => {
  it("字符串配置直接返回", () => {
    expect(resolveRpID("a.com")).toBe("a.com");
  });
  it("数组配置取第一个", () => {
    expect(resolveRpID(["a.com", "b.com"])).toBe("a.com");
  });
  it("逗号分隔字符串取第一段", () => {
    expect(resolveRpID("a.com,b.com")).toBe("a.com");
  });
  it("未配置时回落到请求 host", () => {
    expect(resolveRpID(undefined, "req.example.com")).toBe("req.example.com");
  });
  it("两者都无时返回空串（调用方需自行判空）", () => {
    expect(resolveRpID(undefined, undefined)).toBe("");
  });
  it("数组首项为空时回落到请求 host", () => {
    expect(resolveRpID([""] as never, "a.com")).toBe("a.com");
  });
});

describe("resolveExpectedRPIDs / resolveExpectedOrigins", () => {
  it("字符串配置 → 单元素数组", () => {
    expect(resolveExpectedRPIDs("a.com")).toEqual(["a.com"]);
  });
  it("逗号分隔 → 多元素数组", () => {
    expect(resolveExpectedRPIDs("a.com,b.com")).toEqual(["a.com", "b.com"]);
  });
  it("数组配置 → 原样", () => {
    expect(resolveExpectedRPIDs(["a.com", "b.com"])).toEqual(["a.com", "b.com"]);
  });
  it("未配置且无请求 → 空数组", () => {
    expect(resolveExpectedRPIDs()).toEqual([]);
  });
  it("Origins 同理，且规范化去掉尾斜杠", () => {
    expect(resolveExpectedOrigins("https://a.com/")).toEqual(["https://a.com"]);
    expect(resolveExpectedOrigins("https://a.com,https://b.com")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
    expect(resolveExpectedOrigins()).toEqual([]);
  });
});

describe("safeParseTransports：返回 undefined 而非 []", () => {
  it("null / undefined / 空串 → undefined", () => {
    // 返回 undefined 而不是 [] 是刻意的：传 undefined 表示"未提供该字段"，
    // 由调用方决定是沿用浏览器默认还是回退
    expect(safeParseTransports(null)).toBeUndefined();
    expect(safeParseTransports(undefined as never)).toBeUndefined();
    expect(safeParseTransports("")).toBeUndefined();
  });
  it("JSON 数组字符串 → 解析出数组", () => {
    expect(safeParseTransports('["usb","nfc"]')).toEqual(["usb", "nfc"]);
  });
  it("非法 JSON → undefined（不得抛错打崩登录）", () => {
    expect(safeParseTransports("{not json")).toBeUndefined();
  });
  it("JSON 但不是数组（如对象）→ undefined", () => {
    expect(safeParseTransports('{"a":1}')).toBeUndefined();
  });
});

/* ==================================================== i18n */

describe("detectLanguage", () => {
  it("zh 开头 → zh", () => {
    expect(detectLanguage(new Request("https://x", { headers: { "accept-language": "zh-CN,zh;q=0.9" } }))).toBe("zh");
  });
  it("en 开头 → en", () => {
    expect(detectLanguage(new Request("https://x", { headers: { "accept-language": "en-US,en;q=0.9" } }))).toBe("en");
  });
  it("无请求 → 默认语言", () => {
    expect(detectLanguage()).toBeTruthy();
  });
  it("不支持的语言 → 默认语言", () => {
    expect(detectLanguage(new Request("https://x", { headers: { "accept-language": "fr-FR" } }))).toBeTruthy();
  });
});

describe("handleLangParam", () => {
  it("带 ?lang=en 时返回重定向响应并保留原路径与 query", () => {
    const res = handleLangParam(new Request("https://x/oidc/login?a=1&lang=en"));
    expect(res).toBeInstanceOf(Response);
    expect(res!.status).toBe(302);
    expect(res!.headers.get("Location")).toContain("/oidc/login");
    expect(res!.headers.get("Location")).toContain("a=1");
  });
  it("带 ?lang=zh 同样重定向", () => {
    expect(handleLangParam(new Request("https://x/p?lang=zh"))).toBeInstanceOf(Response);
  });
  it("无 lang 参数 → 返回 null（不拦截正常请求）", () => {
    expect(handleLangParam(new Request("https://x/p?a=1"))).toBeNull();
  });
  it("非 en 开头一律归为 zh（显式选择优于猜测）", () => {
    const res = handleLangParam(new Request("https://x/p?lang=fr"));
    expect(res!.headers.get("Set-Cookie")).toContain("lang=zh");
  });
  it("lang 参数从重定向目标里被移除（否则刷新会循环）", () => {
    const res = handleLangParam(new Request("https://x/p?lang=en&a=1"));
    expect(res!.headers.get("Location")).not.toContain("lang=");
  });
});

describe("getAuthI18n / i18nAssignment", () => {
  it("zh 返回中文字典", () => {
    expect(getAuthI18n("zh")).toBeTypeOf("object");
  });
  it("en 返回英文字典", () => {
    const en = getAuthI18n("en");
    const zh = getAuthI18n("zh");
    expect(Object.keys(en).length).toBe(Object.keys(zh).length);
  });
  it("未知语言回落到默认语言", () => {
    expect(getAuthI18n("fr")).toEqual(getAuthI18n("zh"));
  });
  it("i18nAssignment 产出可执行的赋值语句", () => {
    const js = i18nAssignment("en");
    expect(js).toMatch(/=/);
    expect(js.length).toBeGreaterThan(5);
  });
});

/* ==================================================== crypto */

describe("sha256 / sha256Hex", () => {
  it("字符串与 Uint8Array 产出相同摘要", async () => {
    const a = await sha256Hex("hello");
    const b = await sha256Hex(new TextEncoder().encode("hello"));
    expect(a).toBe(b);
  });
  it("已知向量正确", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
  it("sha256 返回 32 字节", async () => {
    expect((await sha256("x")).length).toBe(32);
  });
});

describe("safeEqual", () => {
  it("相等返回 true", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
  });
  it("不等返回 false", () => {
    expect(safeEqual("abc", "abd")).toBe(false);
  });
  it("长度不同返回 false", () => {
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
  it("非字符串参数返回 false（不得抛错）", () => {
    expect(safeEqual(undefined as never, "a")).toBe(false);
    expect(safeEqual("a", 42 as never)).toBe(false);
  });
});

describe("generateId", () => {
  it("带前缀时输出 prefix_xxx", () => {
    expect(generateId("usr")).toMatch(/^usr_[0-9a-f]+$/);
  });
  it("不带前缀时只有随机部分", () => {
    expect(generateId()).toMatch(/^[0-9a-f]+$/);
  });
  it("两次调用不同", () => {
    expect(generateId("x")).not.toBe(generateId("x"));
  });
});

describe("deriveKey：返回 CryptoKey，salt 决定可复现性", () => {
  it("返回可用于 AES-GCM 的 CryptoKey", async () => {
    const k = await deriveKey("pw", undefined, 1000);
    expect(k.type).toBe("secret");
    expect(k.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
  });
  it("显式 salt 时派生结果可复现（用同 salt 加密解密应成功）", async () => {
    const salt = new Uint8Array(16).fill(7);
    const iv = new Uint8Array(12).fill(1);
    const k = await deriveKey("pw", salt, 1000);
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode("hi")),
    );
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, k, ct);
    expect(new TextDecoder().decode(new Uint8Array(pt))).toBe("hi");
  });
  it("不同 salt 派生的 key 无法解开对方的密文", async () => {
    const iv = new Uint8Array(12).fill(1);
    const k1 = await deriveKey("pw", new Uint8Array(16).fill(1), 1000);
    const k2 = await deriveKey("pw", new Uint8Array(16).fill(2), 1000);
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k1, new TextEncoder().encode("hi")),
    );
    await expect(crypto.subtle.decrypt({ name: "AES-GCM", iv }, k2, ct)).rejects.toThrow();
  });
});

describe("encryptJson / decryptJson", () => {
  it("往返一致", async () => {
    const blob = await encryptJson({ a: 1, b: "x" }, "pw");
    expect(await decryptJson(blob, "pw")).toEqual({ a: 1, b: "x" });
  });
  it("错误口令解不出原文", async () => {
    const blob = await encryptJson({ a: 1 }, "pw");
    await expect(decryptJson(blob, "wrong")).rejects.toThrow();
  });
  it("密文含版本标记", async () => {
    expect(await encryptJson({ a: 1 }, "pw")).toMatch(/^v2\./);
  });
  it("残缺密文抛明确错误", async () => {
    // v2 需要 4 段；给够段数但内容为空才触发 bad encrypted blob
    await expect(decryptJson("v2..", "pw")).rejects.toThrow(/bad encrypted blob/);
    await expect(decryptJson("v2.a.b.", "pw")).rejects.toThrow(/bad encrypted blob/);
  });
});

describe("encryptSecret / decryptSecret", () => {
  it("往返一致", async () => {
    const b = await encryptSecret("s3cret", "pw");
    expect(await decryptSecret(b, "pw")).toBe("s3cret");
  });
  it("空串也能往返", async () => {
    const b = await encryptSecret("", "pw");
    expect(await decryptSecret(b, "pw")).toBe("");
  });
});

describe("hashPassword / verifyPassword", () => {
  it("往返一致（迭代数取自存储的哈希）", async () => {
    const h = await hashPassword("pw", 100_000);
    expect(h).toMatch(/^pbkdf2:sha256:[0-9]+:/);
    expect(await verifyPassword("pw", h)).toBe(true);
  });
  it("错误口令返回 false", async () => {
    const h = await hashPassword("pw", 100_000);
    expect(await verifyPassword("bad", h)).toBe(false);
  });
  it("畸形哈希返回 false 而不是抛错", async () => {
    for (const bad of ["", "x", "a:b", "a:b:c", ":::", "pbkdf2:sha256:1:2:3"]) {
      expect(await verifyPassword("pw", bad)).toBe(false);
    }
  });
  it("哈希里记录的迭代数低于下限时拒绝（fail-closed）", async () => {
    // 用极小迭代数生成的哈希会被 verifyPassword 判 false —— 这是刻意的：
    // 若照单全收，攻击者写入 1 轮哈希的账号就能被轻松爆破。
    const weak = await hashPassword("pw", 1000);
    expect(weak).toContain(":1000:");
    expect(await verifyPassword("pw", weak)).toBe(false);
  });
  it("迭代数畸形（NaN / 非整数 / 越界）→ false", async () => {
    for (const n of ["abc", "1.5", "-1", "1e999", "0"]) {
      const bad = "pbkdf2:sha256:" + n + ":AAAAAAAAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB";
      expect(await verifyPassword("pw", bad)).toBe(false);
    }
  });
});
