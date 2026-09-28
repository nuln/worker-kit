/**
 * 备份二进制列（BLOB）往返保真测试
 *
 * ## 要锁定的行为
 *
 * D1 的 BLOB 列经 `JSON.stringify` 会退化成 `{"0":72,"1":101,…}` 这样的
 * **普通对象**，还原时不再是字节流。更糟的是：由于二次序列化结果完全一致，
 * `bundle.checksum` **无法发现这一损坏** —— 恢复后证书 / 公钥 / 密钥 blob
 * 彻底损坏，且没有任何报错。
 *
 * 修复方式：导出时把二进制值包装成带 `__nuln_bin__` 标记的 base64 对象，
 * 还原时解包。这样：
 * - 往返后字节**完全一致**
 * - 校验和能真实反映内容（编码是确定性的）
 * - 不含 BLOB 的表完全无影响；旧格式（无标记）仍可原样还原，向后兼容
 */

import { describe, it, expect } from "vitest";
import { encodeRowBinary, decodeRowBinary } from "../../src/backup/engine.js";

const bytes = (...v: number[]) => new Uint8Array(v);

describe("备份 BLOB 列往返", () => {
  it("BLOB 编码为带标记的 base64，而非 {0:..,1:..} 普通对象", () => {
    const enc = encodeRowBinary({ id: "u1", pubkey: bytes(1, 2, 3, 255) });
    expect(enc.pubkey).toBeTypeOf("object");
    expect(enc.pubkey).toMatchObject({ __nuln_bin__: expect.any(String) });
    // 关键：不能再退化成带数字键的普通对象
    expect(Object.keys(enc.pubkey as object)).toEqual(["__nuln_bin__"]);
  });

  it("经真实 JSON 往返后字节完全一致", () => {
    const pubkey = bytes(72, 101, 108, 108, 111, 255, 0, 128);
    const enc = encodeRowBinary({ id: "u1", pubkey });
    const wire = JSON.parse(JSON.stringify(enc)); // 存储 / 网络往返
    const dec = decodeRowBinary(wire);
    expect(dec.pubkey).toBeInstanceOf(Uint8Array);
    expect(Array.from(dec.pubkey as Uint8Array)).toEqual(Array.from(pubkey));
  });

  it("ArrayBuffer 同样被正确处理", () => {
    const buf = bytes(9, 8, 7).buffer;
    const enc = encodeRowBinary({ blob: buf });
    const dec = decodeRowBinary(JSON.parse(JSON.stringify(enc)));
    expect(Array.from(dec.blob as Uint8Array)).toEqual([9, 8, 7]);
  });

  it("空 BLOB 保真（不被误判为缺值转成 null）", () => {
    const dec = decodeRowBinary(JSON.parse(JSON.stringify(encodeRowBinary({ b: new Uint8Array(0) }))));
    expect(dec.b).toBeInstanceOf(Uint8Array);
    expect((dec.b as Uint8Array).length).toBe(0);
  });

  it("非二进制列完全不受影响", () => {
    const row = {
      id: "u1",
      email: "a@b.c",
      count: 42,
      active: true,
      nothing: null,
      list: [1, 2, 3],
    };
    expect(decodeRowBinary(JSON.parse(JSON.stringify(encodeRowBinary(row))))).toEqual(row);
  });

  it("旧格式（无标记的 {0:..} 对象）原样还原，向后兼容", () => {
    const legacy = { id: "x", pubkey: { 0: 72, 1: 101 } };
    const dec = decodeRowBinary(legacy);
    expect(dec.pubkey).toEqual({ 0: 72, 1: 101 });
  });

  it("编码是确定性的：同样的输入两次编码结果一致（校验和才有意义）", () => {
    const pubkey = bytes(5, 6, 7);
    expect(encodeRowBinary({ b: pubkey })).toEqual(encodeRowBinary({ b: pubkey }));
  });

  it("不同字节产出不同编码（不会出现碰撞掩盖损坏）", () => {
    const a = encodeRowBinary({ b: bytes(1, 2, 3) });
    const b = encodeRowBinary({ b: bytes(1, 2, 4) });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("含中文/emoji 的字符串列不受影响", () => {
    const row = { title: "备份 😀", name: "报告" };
    expect(decodeRowBinary(JSON.parse(JSON.stringify(encodeRowBinary(row))))).toEqual(row);
  });
});
