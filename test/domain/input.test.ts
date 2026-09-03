import { describe, expect, it } from "vitest";

import { admitInput } from "../../src/domain/input.ts";
import type { LoopState } from "../../src/domain/loop.ts";
import { createLoopState } from "../../src/domain/loop.ts";

const MODEL_MAX = 9;
const TOOL_MAX = 9;

/** perItem 和 total 是这一组唯一在变的两个数。 */
function stateOf(perItem: number, total: number): LoopState {
  const r = createLoopState({
    maxModelCalls: MODEL_MAX,
    maxToolRuns: TOOL_MAX,
    maxInputBytesPerItem: perItem,
    maxInputBytesTotal: total,
  });
  if (!r.ok) throw new Error(`脚手架：上限应该合法，却被拒了 ${r.error.limit}`);
  return r.value;
}

/** 断言用的完整 limits，省得每个用例重写一遍。 */
const limitsOf = (perItem: number, total: number) => ({
  maxModelCalls: MODEL_MAX,
  maxToolRuns: TOOL_MAX,
  maxInputBytesPerItem: perItem,
  maxInputBytesTotal: total,
});

const LONE_SURROGATE = "👍".slice(0, 1);

describe("admitInput", () => {
  // ── 全部接纳 ──────────────────────────────────────────────
  describe("接纳：每段都在 perItem 以内，总和在 total 以内", () => {
    it.each<{
      why: string;
      texts: string[];
      perItem: number;
      total: number;
      bytes: number[];
    }>([
      {
        why: "★空文件是合法内容★",
        texts: [""],
        perItem: 10,
        total: 10,
        bytes: [0],
      },
      {
        why: "一段 ASCII",
        texts: ["hello"],
        perItem: 10,
        total: 10,
        bytes: [5],
      },
      {
        why: "中文按字节算",
        texts: ["你好"],
        perItem: 10,
        total: 10,
        bytes: [6],
      },
      {
        why: "★正好等于 perItem★",
        texts: ["hello"],
        perItem: 5,
        total: 99,
        bytes: [5],
      },
      {
        why: "★两段之和正好等于 total★",
        texts: ["hello", "你好"],
        perItem: 10,
        total: 11,
        bytes: [5, 6],
      },
      {
        why: "多段，含空串",
        texts: ["ab", "", "cd"],
        perItem: 10,
        total: 99,
        bytes: [2, 0, 2],
      },
    ])("$why｜$texts", ({ texts, perItem, total, bytes }) => {
      expect(admitInput(stateOf(perItem, total), texts, "reject")).toEqual({
        ok: true,
        value: {
          state: {
            limits: limitsOf(perItem, total),
            modelCalls: 0,
            toolRuns: 0,
            inputBytes: bytes.reduce((a, b) => a + b, 0),
          },
          items: texts.map((text, i) => ({
            kind: "accepted",
            text,
            bytes: bytes[i],
          })),
        },
      });
    });
  });

  // ── reject 模式 ───────────────────────────────────────────
  describe("reject：单段超过 perItem", () => {
    it.each<{
      why: string;
      texts: string[];
      perItem: number;
      index: number;
      bytes: number;
    }>([
      { why: "超一个字节", texts: ["hello"], perItem: 4, index: 0, bytes: 5 },
      {
        why: "中文的字节比字数多",
        texts: ["你好"],
        perItem: 5,
        index: 0,
        bytes: 6,
      },
      {
        why: "★报的是出问题那一段的下标★",
        texts: ["ok", "你好世界"],
        perItem: 5,
        index: 1,
        bytes: 12,
      },
    ])(
      "$why｜perItem=$perItem → index $index",
      ({ texts, perItem, index, bytes }) => {
        expect(admitInput(stateOf(perItem, 9999), texts, "reject")).toEqual({
          ok: false,
          error: { kind: "item-too-large", index, bytes, max: perItem },
        });
      },
    );
  });

  // ── truncate 模式 ─────────────────────────────────────────
  describe("truncate：超过 perItem 就切", () => {
    it.each<{
      why: string;
      texts: string[];
      perItem: number;
      kept: string;
      originalBytes: number;
      keptBytes: number;
    }>([
      {
        why: "退到字素簇边界",
        texts: ["你好世界"],
        perItem: 5,
        kept: "你",
        originalBytes: 12,
        keptBytes: 3,
      },
      {
        why: "★退到最近的换行★",
        texts: ["abc\ndef\nghi"],
        perItem: 10,
        kept: "abc\ndef\n",
        originalBytes: 11,
        keptBytes: 8,
      },
      {
        why: "★绝不切碎 emoji★",
        texts: ["👍👍"],
        perItem: 5,
        kept: "👍",
        originalBytes: 8,
        keptBytes: 4,
      },
    ])(
      "$why｜perItem=$perItem",
      ({ texts, perItem, kept, originalBytes, keptBytes }) => {
        expect(admitInput(stateOf(perItem, 9999), texts, "truncate")).toEqual({
          ok: true,
          value: {
            state: {
              limits: limitsOf(perItem, 9999),
              modelCalls: 0,
              toolRuns: 0,
              inputBytes: keptBytes,
            },
            items: [
              { kind: "truncated", text: kept, originalBytes, keptBytes },
            ],
          },
        });
      },
    );
  });

  describe("truncate：切完什么都不剩就是错", () => {
    it.each<{
      why: string;
      texts: string[];
      perItem: number;
      index: number;
      originalBytes: number;
    }>([
      {
        why: "一个中文字放不下",
        texts: ["你好"],
        perItem: 2,
        index: 0,
        originalBytes: 6,
      },
      {
        why: "★ZWJ 家庭差一个字节，整个丢光★",
        texts: ["👨‍👩‍👧"],
        perItem: 17,
        index: 0,
        originalBytes: 18,
      },
      {
        why: "报的是出问题那一段",
        texts: ["ok", "你好"],
        perItem: 2,
        index: 1,
        originalBytes: 6,
      },
    ])("$why｜perItem=$perItem", ({ texts, perItem, index, originalBytes }) => {
      expect(admitInput(stateOf(perItem, 9999), texts, "truncate")).toEqual({
        ok: false,
        error: { kind: "truncated-to-empty", index, originalBytes },
      });
    });
  });

  // ── 良构检查 ──────────────────────────────────────────────
  describe("★输入不是良构 Unicode★（上游多半已按下标截断过一次）", () => {
    it.each<{ why: string; texts: string[]; index: number }>([
      { why: "半个代理对", texts: [LONE_SURROGATE], index: 0 },
      { why: "夹在中间", texts: ["ok", `a${LONE_SURROGATE}b`], index: 1 },
      {
        why: "★良构检查在测量之前★：即使它也超 perItem，也报 ill-formed",
        texts: [`${LONE_SURROGATE}xxxxxxxx`],
        index: 0,
      },
    ])("$why｜index $index", ({ texts, index }) => {
      expect(admitInput(stateOf(4, 9999), texts, "truncate")).toEqual({
        ok: false,
        error: { kind: "ill-formed", index },
      });
    });
  });

  // ── 总和上限 ──────────────────────────────────────────────
  describe("总和超过 total", () => {
    it.each<{ why: string; texts: string[]; total: number; used: number }>([
      { why: "两段加起来超", texts: ["hello", "hello"], total: 8, used: 0 },
      {
        why: "★原子性：used 是 0，一个字节都没扣★",
        texts: ["hello"],
        total: 4,
        used: 0,
      },
    ])("$why｜total=$total", ({ texts, total, used }) => {
      expect(admitInput(stateOf(99, total), texts, "reject")).toEqual({
        ok: false,
        error: {
          kind: "limit-reached",
          limit: "input-bytes-total",
          used,
          max: total,
        },
      });
    });
  });

  // ── 不变量 ────────────────────────────────────────────────
  describe("不变量", () => {
    it("★纯函数★：失败之后，传进去的 state 一模一样", () => {
      const before = stateOf(4, 8);
      const snapshot = structuredClone(before);
      admitInput(before, ["你好世界"], "reject");
      admitInput(before, [LONE_SURROGATE], "truncate");
      admitInput(before, ["hello", "hello"], "reject");
      expect(before).toEqual(snapshot);
    });

    it("★成功之后原 state 也没被改★，新状态是另一个对象", () => {
      const before = stateOf(99, 99);
      const r = admitInput(before, ["hello"], "reject");
      expect(before.inputBytes).toBe(0);
      expect(r.ok && r.value.state.inputBytes).toBe(5);
    });

    it("★连续两次调用会累加★", () => {
      const first = admitInput(stateOf(99, 99), ["hello"], "reject");
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(admitInput(first.value.state, ["你好"], "reject")).toEqual({
        ok: true,
        value: {
          state: {
            limits: limitsOf(99, 99),
            modelCalls: 0,
            toolRuns: 0,
            inputBytes: 11,
          },
          items: [{ kind: "accepted", text: "你好", bytes: 6 }],
        },
      });
    });

    it("★truncate 模式下，被接纳的文本永远是良构的★", () => {
      const r = admitInput(
        stateOf(7, 999),
        ["报告：👨‍👩‍👧一家人", "你好世界"],
        "truncate",
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.items.map((i) => i.text.isWellFormed())).toEqual([
        true,
        true,
      ]);
    });
  });
});
