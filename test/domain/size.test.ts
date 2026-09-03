import { describe, expect, it } from "vitest";
import {
  checkSize,
  measureInputText,
  type LimitHandler,
  type UnitType,
} from "../../src/domain/size.ts";
import type {
  InvalidCount,
  LimitReached,
  LoopState,
} from "../../src/domain/loop.ts";
import {
  createLoopState,
  recordModelCall,
  recordToolRuns,
} from "../../src/domain/loop.ts";

function stateOf(
  maxModelCalls: number,
  maxToolRuns: number,
  maxInputTextLength: number,
): LoopState {
  const r = createLoopState({ maxModelCalls, maxToolRuns, maxInputTextLength });
  if (!r.ok) throw new Error(`脚手架：上限应该合法，却被拒了 ${r.error.limit}`);
  return r.value;
}

describe("measureInputText", () => {
  it.each<{
    why: string;
    text: string;
    unit: UnitType;
    value: number;
  }>([
    {
      why: "输入 hello",
      text: "hello",
      unit: "utf-16",
      value: 5,
    },
    {
      why: "输入 你好",
      text: "你好",
      unit: "utf-16",
      value: 2,
    },
    {
      why: "输入 𝕏",
      text: "𝕏",
      unit: "utf-16",
      value: 2,
    },
    {
      why: "输入 👍",
      text: "👍",
      unit: "utf-16",
      value: 2,
    },
    {
      why: "输入 👨‍👩‍👧",
      text: "👨‍👩‍👧",
      unit: "utf-16",
      value: 8,
    },
    {
      why: "输入 hello",
      text: "hello",
      unit: "code-point",
      value: 5,
    },
    {
      why: "输入 你好",
      text: "你好",
      unit: "code-point",
      value: 2,
    },
    {
      why: "输入 𝕏",
      text: "𝕏",
      unit: "code-point",
      value: 1,
    },
    {
      why: "输入 👍",
      text: "👍",
      unit: "code-point",
      value: 1,
    },
    {
      why: "输入 👨‍👩‍👧",
      text: "👨‍👩‍👧",
      unit: "code-point",
      value: 5,
    },
    {
      why: "输入 hello",
      text: "hello",
      unit: "utf-8",
      value: 5,
    },
    {
      why: "输入 你好",
      text: "你好",
      unit: "utf-8",
      value: 6,
    },
    {
      why: "输入 𝕏",
      text: "𝕏",
      unit: "utf-8",
      value: 4,
    },
    {
      why: "输入 👍",
      text: "👍",
      unit: "utf-8",
      value: 4,
    },
    {
      why: "输入 👨‍👩‍👧",
      text: "👨‍👩‍👧",
      unit: "utf-8",
      value: 18,
    },
    {
      why: "输入 hello",
      text: "hello",
      unit: "grapheme",
      value: 5,
    },
    {
      why: "输入 你好",
      text: "你好",
      unit: "grapheme",
      value: 2,
    },
    {
      why: "输入 𝕏",
      text: "𝕏",
      unit: "grapheme",
      value: 1,
    },
    {
      why: "输入 👍",
      text: "👍",
      unit: "grapheme",
      value: 1,
    },
    {
      why: "输入 👨‍👩‍👧",
      text: "👨‍👩‍👧",
      unit: "grapheme",
      value: 1,
    },
  ])("$why|{$text, $unit} → $value", ({ text, unit, value }) => {
    expect(measureInputText(text, unit)).toEqual({
      unit,
      value,
    });
  });
});

describe("checkSize", () => {
  describe("大小满足上限", () => {
    it.each<{
      why: string;
      size: number[];
      max: number;
      value: number;
    }>([
      {
        why: "",
        size: [1],
        max: 1,
        value: 1,
      },
      {
        why: "",
        size: [1, 2],
        max: 3,
        value: 3,
      },
      {
        why: "",
        size: [100, 221],
        max: 1000,
        value: 321,
      },
    ])("$why| {$size, $max} → $value", ({ size, max, value }) => {
      expect(checkSize(size, stateOf(1, 1, max).limits)).toEqual({
        ok: true,
        value: value,
      });
    });
  });

  describe("单个大小不满足上限", () => {
    it.each<{
      why: string;
      size: number[];
      index: number;
      max: number;
      value: number;
    }>([
      {
        why: "",
        size: [101],
        index: 0,
        max: 100,
        value: 101,
      },
      {
        why: "",
        size: [1, 51],
        index: 1,
        max: 50,
        value: 51,
      },
    ])(
      "$why| {$size, $max} → {$value, $index}",
      ({ size, index, max, value }) => {
        expect(checkSize(size, stateOf(1, 1, max).limits)).toEqual({
          ok: false,
          value: {
            kind: "single",
            index,
            value,
            max,
          },
        });
      },
    );
  });

  describe("总大小不满足上限", () => {
    it.each<{
      why: string;
      size: number[];
      max: number;
      value: number;
    }>([
      {
        why: "",
        size: [1],
        max: 1,
        value: 1,
      },
    ])("$why| {$size, $max} → {$value, $index}", ({ size, max, value }) => {
      expect(checkSize(size, stateOf(1, 1, max).limits)).toEqual({
        ok: false,
        value: {
          kind: "aggregate",
          value,
          max,
        },
      });
    });
  });
});

describe("parseInputText", () => {
  it.each<{
    why: string;
    text: string;
    mode: LimitHandler;
    value: number;
  }>([])("$why| {text, mode} → value", ({}) => {
    expect(checkSize(size, stateOf(1, 1, max).limits)).toEqual({
      ok: false,
      value: {
        kind: "aggregate",
        value,
        max,
      },
    });
  });
});

describe("不变量", () => {});
