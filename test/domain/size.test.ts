import { describe, expect, it } from "vitest";

import { measure, truncateToBytes } from "../../src/domain/size.ts";

/**
 * ⚠ 组合重音必须写成 ́ 转义。
 * 直接在源码里贴 "é" 的组合形式，编辑器 / 终端 / git 都可能悄悄把它
 * 归一化成预组合形式，测试就测不到"同一个字两种长度"这件事了。
 */
const E_COMBINING = "e\u0301"; // e + U+0301，看起来是 é
const E_PRECOMPOSED = "\u00e9"; // 单个码点的 é
const LONE_SURROGATE = "👍".slice(0, 1); // 半个代理对，不良构

describe("measure", () => {
  // 一行一个字符串，四个单位一起断言 ——
  // ★这样每一行本身就是"同一个东西四个数字"的证据★
  it.each<{
    why: string;
    text: string;
    utf8: number;
    utf16: number;
    codePoints: number;
    graphemes: number;
  }>([
    { why: "空串", text: "", utf8: 0, utf16: 0, codePoints: 0, graphemes: 0 },
    {
      why: "纯 ASCII，四个数字相同",
      text: "hello",
      utf8: 5,
      utf16: 5,
      codePoints: 5,
      graphemes: 5,
    },
    {
      why: "中文：字节是长度的 3 倍",
      text: "你好",
      utf8: 6,
      utf16: 2,
      codePoints: 2,
      graphemes: 2,
    },
    // ★这两行是一对★：屏幕上一模一样，四个数字有三个不同
    {
      why: "★组合重音★ e + U+0301",
      text: E_COMBINING,
      utf8: 3,
      utf16: 2,
      codePoints: 2,
      graphemes: 1,
    },
    {
      why: "★预组合★ U+00E9，看起来完全一样",
      text: E_PRECOMPOSED,
      utf8: 2,
      utf16: 1,
      codePoints: 1,
      graphemes: 1,
    },
    {
      why: "星平面字母：utf16 是 2，码点是 1",
      text: "𝕏",
      utf8: 4,
      utf16: 2,
      codePoints: 1,
      graphemes: 1,
    },
    {
      why: "emoji",
      text: "👍",
      utf8: 4,
      utf16: 2,
      codePoints: 1,
      graphemes: 1,
    },
    {
      why: "★ZWJ 家庭★ 1 和 18 差 18 倍",
      text: "👨‍👩‍👧",
      utf8: 18,
      utf16: 8,
      codePoints: 5,
      graphemes: 1,
    },
    {
      why: "国旗 = 两个区域指示符",
      text: "🇯🇵",
      utf8: 8,
      utf16: 4,
      codePoints: 2,
      graphemes: 1,
    },
    // ★半截字符★：utf8 不是 2 —— 半个代理对没有 UTF-8 编码，
    // 只能被替换成 U+FFFD（3 字节）。见 docs/01 第 12 节。
    {
      why: "★半个代理对★ utf8 是 3 不是 2",
      text: LONE_SURROGATE,
      utf8: 3,
      utf16: 1,
      codePoints: 1,
      graphemes: 1,
    },
  ])(
    "$why｜$utf8 / $utf16 / $codePoints / $graphemes",
    ({ text, utf8, utf16, codePoints, graphemes }) => {
      expect({
        "utf-8": measure(text, "utf-8"),
        "utf-16": measure(text, "utf-16"),
        "code-point": measure(text, "code-point"),
        grapheme: measure(text, "grapheme"),
      }).toEqual({
        "utf-8": utf8,
        "utf-16": utf16,
        "code-point": codePoints,
        grapheme: graphemes,
      });
    },
  );
});

describe("truncateToBytes", () => {
  describe("不超限：原样返回", () => {
    it.each<{ why: string; text: string; max: number }>([
      { why: "空串", text: "", max: 10 },
      { why: "正好等于上限", text: "hello", max: 5 },
      { why: "★正好等于上限，有换行也不切★", text: "abc\ndef\nghi", max: 11 },
      { why: "中文正好等于上限", text: "你好世界", max: 12 },
      { why: "上限远大于内容", text: "hi", max: 1000 },
    ])("$why｜$max", ({ text, max }) => {
      expect(truncateToBytes(text, max)).toBe(text);
    });
  });

  describe("有换行：退到最近的换行（保留换行本身）", () => {
    it.each<{ why: string; text: string; max: number; kept: string }>([
      // ★和上面"正好等于上限"那行只差 1 个字节，结果差 3 个字节★
      { why: "上限 −1", text: "abc\ndef\nghi", max: 10, kept: "abc\ndef\n" },
      { why: "退两段", text: "abc\ndef\nghi", max: 7, kept: "abc\n" },
      {
        why: "安全前缀刚好以换行结尾",
        text: "abc\ndef\nghi",
        max: 4,
        kept: "abc\n",
      },
      {
        why: "★退无可退：前缀里没有换行★",
        text: "abc\ndef\nghi",
        max: 3,
        kept: "abc",
      },
    ])("$why｜max=$max", ({ text, max, kept }) => {
      expect(truncateToBytes(text, max)).toBe(kept);
    });
  });

  describe("没有换行：退到最近的字素簇边界", () => {
    it.each<{ why: string; text: string; max: number; kept: string }>([
      {
        why: "多余 1 字节，退掉一整个字",
        text: "你好世界",
        max: 11,
        kept: "你好世",
      },
      { why: "只放得下一个字", text: "你好世界", max: 5, kept: "你" },
      { why: "★一个字都放不下 → 空串★", text: "你好世界", max: 2, kept: "" },
      // ★关键★：max=5 时 emoji 占 4 字节，绝不会切出半个
      { why: "★绝不切碎 emoji★", text: "👍👍", max: 5, kept: "👍" },
      { why: "ZWJ 家庭整个保住", text: "👨‍👩‍👧x", max: 18, kept: "👨‍👩‍👧" },
      { why: "ZWJ 家庭差 1 字节，整个丢掉", text: "👨‍👩‍👧x", max: 17, kept: "" },
    ])("$why｜max=$max", ({ text, max, kept }) => {
      expect(truncateToBytes(text, max)).toBe(kept);
    });
  });

  // ── 不变量 ──────────────────────────────────────────────────
  // 例子测试验证"我想到的情况"，不变量搜索"我没想到的"。
  // 阶段 1.5 接 fast-check 时，这三条会长成属性测试。
  describe("不变量（遍历 0..24 的每一个上限）", () => {
    const SAMPLE = "报告：👨‍👩‍👧 一家人\n第二行\n第三行";
    const maxes = Array.from({ length: 25 }, (_, i) => i);

    it("★结果永远是良构 Unicode★ —— 从不切碎字符", () => {
      const bad = maxes.filter(
        (m) => !truncateToBytes(SAMPLE, m).isWellFormed(),
      );
      expect(bad).toEqual([]);
    });

    it("★结果的字节数永远不超过上限★", () => {
      const over = maxes.filter(
        (m) => measure(truncateToBytes(SAMPLE, m), "utf-8") > m,
      );
      expect(over).toEqual([]);
    });

    it("★结果永远是原文的前缀★ —— 只删不改", () => {
      const notPrefix = maxes.filter(
        (m) => !SAMPLE.startsWith(truncateToBytes(SAMPLE, m)),
      );
      expect(notPrefix).toEqual([]);
    });
  });
});
