/**
 * `truncateForPlatform` —— 平台长度防爆的单元测试
 *
 * ## 为什么这些用例看着"琐碎"
 *
 * 截断器本身只有十几行，但它挡在**所有告警**的必经之路上。
 * 它出的问题有三种形态，且都不报错：
 *
 * 1. 切出非法字符（劈开 UTF-8 序列 / 代理对）→ 平台 400，**整条丢失**
 * 2. 切出标记不配对（半个标签、半个代码块）→ 平台 400，**整条丢失**
 * 3. 切得过多 → 内容被截掉但没人知道（信息悄悄损失）
 *
 * 前两种在测试里表现为"字符串里出现了 U+FFFD"或"标签数为奇数"，
 * 第三种表现为"长度恰好等于上限"。所以每个用例都直接断言这三件事。
 */

import { describe, it, expect } from "vitest";
import { truncateForPlatform, PLATFORM_LIMITS } from "../../src/notify/security.js";

/** 与实现同步的 void 元素集合（HTML 规范中无闭合标签的元素） */
const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

const enc = new TextEncoder();
const byteLen = (s: string) => enc.encode(s).length;
const charLen = (s: string) => [...s].length;

/** 统计未闭合的成对标签（奇数即为不配对） */
const unbalanced = (s: string): string[] => {
  const stack: string[] = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const [, closing, name, self] = m;
    // 与实现保持一致：自闭合语法与 void 元素都不入栈
    if (self === "/") continue;
    if (VOID.has(name!.toLowerCase())) continue;
    if (closing === "/") {
      const at = stack.lastIndexOf(name!.toLowerCase());
      if (at !== -1) stack.length = at;
    } else stack.push(name!.toLowerCase());
  }
  return stack;
};

describe("未超限时：原样返回，一字不改", () => {
  it("恰好等于上限也原样返回", () => {
    const s = "a".repeat(100);
    expect(truncateForPlatform(s, 100)).toBe(s);
  });

  it("短于上限原样返回", () => {
    expect(truncateForPlatform("短消息", 100)).toBe("短消息");
  });

  it("未超限时不做任何标记修复（不改动本就正确的内容）", () => {
    // 故意给一段标签不配对但长度合规的内容：不该被"顺手修好"，
    // 否则无法区分"截断导致的修复"与"静默改写用户内容"。
    const s = "<b>未闭合";
    expect(truncateForPlatform(s, 1000)).toBe(s);
  });

  it("空串与上限为 0 的边界", () => {
    expect(truncateForPlatform("", 100)).toBe("");
    expect(truncateForPlatform("任意内容", 0)).toBe("");
    expect(truncateForPlatform("x", -5)).toBe("");
  });

  it("null / undefined 输入不抛错", () => {
    expect(() => truncateForPlatform(null as never, 10)).not.toThrow();
    expect(() => truncateForPlatform(undefined as never, 10)).not.toThrow();
  });
});

describe("字符计量：按 Unicode 码点，不劈开代理对", () => {
  it("全 emoji 内容按码点截断，不产生孤立代理项", () => {
    const s = "🚀".repeat(50);
    const out = truncateForPlatform(s, 10, "...", "char");
    expect(charLen(out)).toBeLessThanOrEqual(10);
    // 孤立代理项会被 JSON 序列化替换为 U+FFFD
    expect(out, "不得出现替换符 U+FFFD").not.toContain("\uFFFD");
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("CJK 扩展字（占 2 个 UTF-16 code unit）不被劈开", () => {
    const s = "\u{20000}".repeat(20); // 𠀀
    const out = truncateForPlatform(s, 5, "...", "char");
    expect(out).not.toContain("\uFFFD");
    expect(charLen(out)).toBeLessThanOrEqual(5);
  });

  it("中英混排按码点截断", () => {
    const s = "中文内容English内容".repeat(20);
    const out = truncateForPlatform(s, 12, "...", "char");
    expect(charLen(out)).toBeLessThanOrEqual(12);
    expect(out).not.toContain("\uFFFD");
  });
});

describe("字节计量：不劈开 UTF-8 序列", () => {
  it("纯中文按字节截断，结果仍是合法 UTF-8", () => {
    const s = "中".repeat(200);
    const out = truncateForPlatform(s, 30, "...", "byte");
    expect(byteLen(out)).toBeLessThanOrEqual(30);
    expect(out).not.toContain("\uFFFD");
    // 逐字节解码必须无损
    expect(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(enc.encode(out))).toBe(out);
  });

  it("中英 emoji 混排按字节截断", () => {
    const s = "🚀中文abc".repeat(30);
    const out = truncateForPlatform(s, 40, "...", "byte");
    expect(byteLen(out)).toBeLessThanOrEqual(40);
    expect(() => new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(enc.encode(out))).not.toThrow();
  });

  it("一个多字节字符放不下时直接停止，不留半个", () => {
    const out = truncateForPlatform("中文", 20, "...", "byte");
    expect(byteLen(out)).toBeLessThanOrEqual(20);
    expect(out).not.toContain("\uFFFD");
  });

  it("兜底路径返回「能放下的后缀前缀」，而不是超限内容", () => {
    // 上限小于后缀长度时，正文与修复都无处安放，只能截后缀本身。
    // 后缀 "..." 的首字符 "." 仍放得下 1 字节 —— 这是有意的：
    // 返回空串会让接收方误以为"没有内容"，返回半个标记则明确表达了
    // "内容被截断了"。两种都不超限，这一条钉住选后者。
    expect(truncateForPlatform("中文", 1, "...", "byte")).toBe(".");
    expect(truncateForPlatform("中文", 2, "...", "byte")).toBe("..");
    // 上限为 0 才是真的什么都放不下
    expect(truncateForPlatform("中文", 0, "...", "byte")).toBe("");
  });
});

describe("标记闭合：截断不制造无效 HTML / Markdown", () => {
  it("被截断的 <font> 被补齐（WeCom 真实场景）", () => {
    const s = `<font color="info">${"内容".repeat(2000)}`;
    const out = truncateForPlatform(s, 100, "...", "byte");
    expect(unbalanced(out), "不得留下未闭合标签").toEqual([]);
    expect(out).toContain("</font>");
  });

  it("多层嵌套按正确顺序闭合（逆序，不是集合）", () => {
    const s = "<div><span><b>" + "x".repeat(5000);
    const out = truncateForPlatform(s, 100, "...", "char");
    expect(out.length).toBeLessThanOrEqual(100);
    expect(unbalanced(out)).toEqual([]);
    // 正确顺序：先 b 再 span 再 div
    const order = ["</b>", "</span>", "</div>"].map((t) => out.indexOf(t));
    expect(order.every((i) => i >= 0), "三个闭合标签都应存在").toBe(true);
    expect(order[0]).toBeLessThan(order[1]!);
    expect(order[1]).toBeLessThan(order[2]!);
  });

  it("自闭合与 void 标签不产生多余的闭合标签", () => {
    const s = "a<br/>b<br>hr".repeat(50);
    const out = truncateForPlatform(s, 100, "...", "char");
    expect(out).not.toContain("</br>");
    expect(out).not.toContain("</hr>");
  });

  it("已闭合的标签不被重复闭合", () => {
    const s = "<b>粗体</b>" + "x".repeat(5000);
    const out = truncateForPlatform(s, 60, "...", "char");
    expect(out.match(/<b>/g)?.length).toBe(1);
    expect(out.match(/<\/b>/g)?.length).toBe(1);
  });

  it("未闭合的三反引号代码块被补齐", () => {
    const s = "```ts\nconst a = 1;\n" + "code".repeat(500);
    const out = truncateForPlatform(s, 100, "...", "char");
    expect(out.length).toBeLessThanOrEqual(100);
    // 围栏个数必须为偶数：奇数意味着代码块没关上
    // （注意 /m 下的 `^` 只匹配行首，而 `out` 含换行，故这里统计全文出现次数）
    const fences = (out.match(/```/g) ?? []).length;
    expect(fences % 2, `围栏必须成对，实际 ${fences} 个`).toBe(0);
    expect(out.endsWith("```"), "闭合围栏应落在结尾").toBe(true);
  });

  it("已闭合的代码块不被重复补围栏", () => {
    const s = "```\ncode\n```" + "x".repeat(500);
    const out = truncateForPlatform(s, 100, "...", "char");
    const fences = (out.match(/```/g) ?? []).length;
    expect(fences % 2, `围栏必须成对，实际 ${fences} 个`).toBe(0);
  });

  it("未闭合的行内反引号被补齐", () => {
    const s = "值是 `code" + "x".repeat(500);
    const out = truncateForPlatform(s, 100, "...", "char");
    expect(out.length).toBeLessThanOrEqual(100);
    // 去掉三反引号围栏后再数单反引号
    const inline = out.replace(/```[\s\S]*?```/g, "").match(/(?<!`)`(?!`)/g)?.length ?? 0;
    expect(inline % 2, `行内反引号必须成对，实际 ${inline} 个`).toBe(0);
  });

  it("纯文本无需修复", () => {
    const s = "没有任何标记的纯文本".repeat(200);
    const out = truncateForPlatform(s, 100, "...", "char");
    expect(out).not.toContain("</");
  });
});

describe("后缀预算：截断结果一定不超限", () => {
  it("超长内容 + 默认后缀：结果仍在上限内", () => {
    const s = "x".repeat(10000);
    for (const limit of [64, 100, 4096]) {
      const out = truncateForPlatform(s, limit);
      expect(out.length, `limit=${limit}`).toBeLessThanOrEqual(limit);
    }
  });

  it("字节计量下同样不超限", () => {
    const s = "中".repeat(5000);
    for (const limit of [64, 256, 4096]) {
      const out = truncateForPlatform(s, limit, "...", "byte");
      expect(byteLen(out), `limit=${limit}`).toBeLessThanOrEqual(limit);
    }
  });

  it("自定义后缀计入上限", () => {
    const s = "x".repeat(1000);
    const out = truncateForPlatform(s, 30, "[内容过长已截断]", "char");
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out).toContain("[内容过长已截断]");
  });

  it("后缀本身超长时只保留能放下的部分（永不超限）", () => {
    // 兜底分支返回的是「截断后的后缀」，计量口径必须与 unit 一致
    const out = truncateForPlatform("x".repeat(1000), 5, "很长的截断标记".repeat(10), "char");
    expect(charLen(out)).toBeLessThanOrEqual(5);
  });

  it("字节计量 + 超长后缀同样不超限", () => {
    const out = truncateForPlatform("中".repeat(500), 8, "很长的截断标记".repeat(10), "byte");
    expect(byteLen(out)).toBeLessThanOrEqual(8);
  });

  it("空后缀：不追加任何标记，且结果仍不超限", () => {
    // 上限小于"修复预留"时正文放不下，只返回空串。
    // 这是刻意的取舍：宁可内容全丢，也不能让整条消息超限被平台丢弃 ——
    // 那样连"内容过长"这个事实都不会传出去。
    const tiny = truncateForPlatform("x".repeat(1000), 20, "", "char");
    expect(tiny).toBe("");
    // 上限充足时正文完整保留，且尾部没有多余标记
    const roomy = truncateForPlatform("x".repeat(1000), 100, "", "char");
    expect(roomy).toBe("x".repeat(68));
    expect(roomy).not.toContain("...");
  });

  it("空后缀时不会为了塞内容而丢弃修复保证", () => {
    // 上限 40 < 预留 32 + 后缀 0 → 仍能放下 8 个字符正文
    const out = truncateForPlatform("x".repeat(1000), 40, "", "char");
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out).toHaveLength(8);
  });

  it("修复标签所需的额外长度仍被计入上限", () => {
    // 深层嵌套 → 闭合标签很长；若不预留，收尾就会超限
    const s = "<a><b><i><u><em>" + "x".repeat(5000);
    for (const limit of [60, 120, 200]) {
      const out = truncateForPlatform(s, limit, "...", "char");
      expect(out.length, `limit=${limit}`).toBeLessThanOrEqual(limit);
      expect(unbalanced(out), `limit=${limit}`).toEqual([]);
    }
  });
});

describe("PLATFORM_LIMITS：与各平台公开限制一致", () => {
  it("Telegram text 上限 4096 字符", () => {
    expect(PLATFORM_LIMITS.telegram).toEqual({ maxLength: 4096, unit: "char" });
  });

  it("WeCom markdown.content 上限 4096 字节", () => {
    expect(PLATFORM_LIMITS.wecom).toEqual({ maxLength: 4096, unit: "byte" });
  });

  it("Bark 约 4KB", () => {
    expect(PLATFORM_LIMITS.bark.maxLength).toBeGreaterThanOrEqual(4000);
    expect(PLATFORM_LIMITS.bark.maxLength).toBeLessThanOrEqual(4096);
  });

  it("飞书 20000 字符", () => {
    expect(PLATFORM_LIMITS.feishu).toEqual({ maxLength: 20000, unit: "char" });
  });

  it("全部平台的限制均为正整数，且 unit 合法", () => {
    for (const [name, v] of Object.entries(PLATFORM_LIMITS)) {
      expect(Number.isInteger(v.maxLength) && v.maxLength > 0, name).toBe(true);
      expect(["char", "byte"], name).toContain(v.unit);
    }
  });

  it("用平台限制直接截断一段超长告警，仍满足该平台口径", () => {
    const alert = "异常堆栈：\n" + "at foo (bar.ts:1:1)\n".repeat(2000);
    for (const [name, limit] of Object.entries(PLATFORM_LIMITS)) {
      const out = truncateForPlatform(alert, limit.maxLength, undefined, limit.unit);
      const actual = limit.unit === "char" ? charLen(out) : byteLen(out);
      expect(actual, name).toBeLessThanOrEqual(limit.maxLength);
      expect(unbalanced(out), name).toEqual([]);
    }
  });
});
