import { describe, expect, it } from "vitest";

import type {
  InvalidCount,
  InsufficientBudget,
  LoopBudget,
} from "../../src/domain/loop.ts";
import {
  createLoopBudget,
  recordInputBytes,
  recordModelCall,
  recordToolRuns,
} from "../../src/domain/loop.ts";
import type { Result } from "../../src/domain/result.ts";
import { ok } from "../../src/domain/result.ts";

// ── 测试脚手架 ────────────────────────────────────────────────
// ★脚手架里可以有分支，断言里不能。★
// 分支写在这里，每个 it 的 body 就能保持「一句整体断言」。

/** 本组测试不关心字节上限，给一个够大的固定值，让它不参与鉴别。 */
const BYTES_UNUSED = { maxInputBytesPerItem: 4096, maxInputBytesTotal: 65536 };

/** 造一个上限合法的初始状态。上限不合法说明测试自己写错了。 */
function stateOf(maxModelCalls: number, maxToolRuns: number): LoopBudget {
  const r = createLoopBudget({ maxModelCalls, maxToolRuns, ...BYTES_UNUSED });
  if (!r.ok) throw new Error(`脚手架：上限应该合法，却被拒了 ${r.error.limit}`);
  return r.value;
}

/** 连续调 times 次模型，中途失败就把失败原样返回。 */
function callModel(
  state: LoopBudget,
  times: number,
): Result<LoopBudget, InsufficientBudget> {
  let r: Result<LoopBudget, InsufficientBudget> = ok(state);
  for (let i = 0; i < times; i++) {
    if (!r.ok) return r;
    r = recordModelCall(r.value);
  }
  return r;
}

/** 按批次跑工具：[3, 2] 表示第一次响应要 3 个工具，第二次要 2 个。 */
function runTools(
  state: LoopBudget,
  batches: readonly number[],
): Result<LoopBudget, InsufficientBudget | InvalidCount> {
  let r: Result<LoopBudget, InsufficientBudget | InvalidCount> = ok(state);
  for (const n of batches) {
    if (!r.ok) return r;
    r = recordToolRuns(r.value, n);
  }
  return r;
}

// ══════════════════════════════════════════════════════════════
/** 本组只关心字节上限，模型/工具上限给够大的固定值。 */
function bytesStateOf(total: number): LoopBudget {
  const r = createLoopBudget({
    maxModelCalls: 9,
    maxToolRuns: 9,
    maxInputBytesPerItem: 4096,
    maxInputBytesTotal: total,
  });
  if (!r.ok) throw new Error(`脚手架：上限应该合法，却被拒了 ${r.error.limit}`);
  return r.value;
}

/** 连续记 batches 里的每一段字节数，中途失败原样返回。 */
function recordBytes(
  state: LoopBudget,
  batches: readonly number[],
): Result<LoopBudget, InsufficientBudget | InvalidCount> {
  let r: Result<LoopBudget, InsufficientBudget | InvalidCount> = ok(state);
  for (const n of batches) {
    if (!r.ok) return r;
    r = recordInputBytes(r.value, n);
  }
  return r;
}

describe("createLoopBudget", () => {
  describe("拒绝非法上限", () => {
    it.each<{
      why: string;
      model: number;
      tool: number;
      perItem?: number;
      total?: number;
      limit: string;
      value: number;
    }>([
      {
        why: "0 不是有效轮数",
        model: 0,
        tool: 1,
        limit: "model-calls",
        value: 0,
      },
      { why: "负数", model: -1, tool: 1, limit: "model-calls", value: -1 },
      { why: "小数", model: 3.3, tool: 1, limit: "model-calls", value: 3.3 },
      {
        why: "Infinity",
        model: Infinity,
        tool: 1,
        limit: "model-calls",
        value: Infinity,
      },
      { why: "NaN", model: NaN, tool: 1, limit: "model-calls", value: NaN },
      // ★这条是这张表的核心★：isInteger 放行，但 2**53 + 1 === 2**53，
      // 计数器加不上去 —— 循环永远到不了上限。只有 isSafeInteger 挡得住。
      {
        why: "★超出安全整数★",
        model: 2 ** 53,
        tool: 1,
        limit: "model-calls",
        value: 2 ** 53,
      },

      { why: "工具上限为 0", model: 1, tool: 0, limit: "tool-runs", value: 0 },
      {
        why: "工具上限为负",
        model: 1,
        tool: -1,
        limit: "tool-runs",
        value: -1,
      },
      {
        why: "工具上限是小数",
        model: 1,
        tool: 2.5,
        limit: "tool-runs",
        value: 2.5,
      },

      // 契约③：两个都非法时只报第一个
      {
        why: "单段字节上限为 0",
        model: 1,
        tool: 1,
        perItem: 0,
        limit: "input-bytes-per-item",
        value: 0,
      },
      {
        why: "总字节上限是小数",
        model: 1,
        tool: 1,
        total: 1.5,
        limit: "input-bytes-total",
        value: 1.5,
      },
      // 契约③：多个都非法时只报第一个，顺序是 model → tool → perItem → total
      {
        why: "★四个都非法，只报 model-calls★",
        model: 0,
        tool: 0,
        perItem: 0,
        total: 0,
        limit: "model-calls",
        value: 0,
      },
    ])(
      "$why｜{$model, $tool} → $limit",
      ({ model, tool, perItem, total, limit, value }) => {
        expect(
          createLoopBudget({
            maxModelCalls: model,
            maxToolRuns: tool,
            maxInputBytesPerItem: perItem ?? BYTES_UNUSED.maxInputBytesPerItem,
            maxInputBytesTotal: total ?? BYTES_UNUSED.maxInputBytesTotal,
          }),
        ).toEqual({
          ok: false,
          error: { kind: "invalid-limit", limit, value },
        });
      },
    );
  });

  describe("接受合法上限，计数从 0 起", () => {
    it.each<{ why: string; model: number; tool: number }>([
      { why: "最小的合法值", model: 1, tool: 1 },
      { why: "常规值", model: 3, tool: 5 },
      { why: "安全整数的上边界", model: Number.MAX_SAFE_INTEGER, tool: 1 },
    ])("$why｜{$model, $tool}", ({ model, tool }) => {
      expect(
        createLoopBudget({
          maxModelCalls: model,
          maxToolRuns: tool,
          ...BYTES_UNUSED,
        }),
      ).toEqual({
        ok: true,
        value: {
          limits: { maxModelCalls: model, maxToolRuns: tool, ...BYTES_UNUSED },
          modelCalls: 0,
          toolRuns: 0,
          inputBytes: 0,
        },
      });
    });
  });
});

// ══════════════════════════════════════════════════════════════
// ★这一组是整个模块存在的理由★：到 max 就停。
// 表格是二维的 —— max 一列、调用次数一列，两列都在变。
describe("recordModelCall", () => {
  const TOOL_MAX = 9; // 固定，用来证明模型计数不碰工具计数

  describe("额度内", () => {
    it.each<{ max: number; times: number }>([
      { max: 1, times: 1 },
      { max: 2, times: 1 },
      { max: 2, times: 2 },
      { max: 3, times: 3 },
      { max: 5, times: 4 },
    ])("上限 $max，调 $times 次 → 允许", ({ max, times }) => {
      expect(callModel(stateOf(max, TOOL_MAX), times)).toEqual({
        ok: true,
        value: {
          limits: {
            maxModelCalls: max,
            maxToolRuns: TOOL_MAX,
            ...BYTES_UNUSED,
          },
          modelCalls: times,
          toolRuns: 0,
          inputBytes: 0,
        },
      });
    });
  });

  describe("超出额度", () => {
    // ★这三行就是「max = 1 / 2 / 3 各允许几轮」的答案★
    // （max = 0 不在表里，因为它根本构造不出来）
    it.each<{ max: number; times: number }>([
      { max: 1, times: 2 },
      { max: 2, times: 3 },
      { max: 3, times: 4 },
      { max: 3, times: 99 }, // 超很多也停在同一处
    ])("上限 $max，调 $times 次 → 拒绝", ({ max, times }) => {
      expect(callModel(stateOf(max, TOOL_MAX), times)).toEqual({
        ok: false,
        error: {
          kind: "insufficient-budget",
          limit: "model-calls",
          used: max,
          max,
        },
      });
    });
  });
});

// ══════════════════════════════════════════════════════════════
describe("recordToolRuns", () => {
  const MODEL_MAX = 9;

  describe("额度内", () => {
    it.each<{ why: string; max: number; batches: number[]; total: number }>([
      { why: "一次响应要 3 个工具", max: 5, batches: [3], total: 3 },
      { why: "★正好用完★", max: 5, batches: [3, 2], total: 5 },
      { why: "一次就用完", max: 3, batches: [3], total: 3 },
      { why: "每次一个，用满", max: 5, batches: [1, 1, 1, 1, 1], total: 5 },
    ])(
      "$why｜上限 $max，批次 $batches → 共 $total",
      ({ max, batches, total }) => {
        expect(runTools(stateOf(MODEL_MAX, max), batches)).toEqual({
          ok: true,
          value: {
            limits: {
              maxModelCalls: MODEL_MAX,
              maxToolRuns: max,
              ...BYTES_UNUSED,
            },
            modelCalls: 0,
            toolRuns: total,
            inputBytes: 0,
          },
        });
      },
    );
  });

  describe("超出额度", () => {
    it.each<{ why: string; max: number; batches: number[]; used: number }>([
      { why: "第二批超了", max: 5, batches: [3, 3], used: 3 },
      { why: "用满之后再来一个", max: 5, batches: [3, 2, 1], used: 5 },
      // ★契约⑥的原子性★：额度剩 2，来了 3 个 —— 一个都不跑，used 停在 0
      { why: "★原子性：额度不够就一个都不跑★", max: 2, batches: [3], used: 0 },
      {
        why: "★原子性：剩 1 个额度，来 2 个★",
        max: 3,
        batches: [2, 2],
        used: 2,
      },
    ])(
      "$why｜上限 $max，批次 $batches → 拒绝，used=$used",
      ({ max, batches, used }) => {
        expect(runTools(stateOf(MODEL_MAX, max), batches)).toEqual({
          ok: false,
          error: { kind: "insufficient-budget", limit: "tool-runs", used, max },
        });
      },
    );
  });

  describe("拒绝非法的工具个数", () => {
    it.each<{ why: string; count: number }>([
      { why: "一次响应要 0 个工具，不该走到这里", count: 0 },
      { why: "负数", count: -1 },
      { why: "小数", count: 2.5 },
      { why: "Infinity", count: Infinity },
      { why: "NaN", count: NaN },
      { why: "超出安全整数", count: 2 ** 53 },
    ])("$why｜count=$count", ({ count }) => {
      expect(recordToolRuns(stateOf(9, 9), count)).toEqual({
        ok: false,
        error: { kind: "invalid-count", value: count },
      });
    });
  });
});

// ══════════════════════════════════════════════════════════════
describe("recordInputBytes", () => {
  describe("额度内", () => {
    it.each<{ why: string; total: number; batches: number[]; used: number }>([
      { why: "一段", total: 100, batches: [10], used: 10 },
      { why: "两段累加", total: 100, batches: [10, 20], used: 30 },
      { why: "★正好用完★", total: 30, batches: [10, 20], used: 30 },
      // ★这一条和 recordToolRuns 相反★：那边 count=0 非法（一次响应要 0 个
      // 工具说明上游出错了），这边 bytes=0 合法 —— 0 字节的文件真实存在。
      { why: "★空文件：0 字节合法★", total: 100, batches: [0], used: 0 },
      { why: "多段 0 字节", total: 100, batches: [0, 0, 5], used: 5 },
    ])(
      "$why｜上限 $total，批次 $batches → $used",
      ({ total, batches, used }) => {
        expect(recordBytes(bytesStateOf(total), batches)).toEqual({
          ok: true,
          value: {
            limits: {
              maxModelCalls: 9,
              maxToolRuns: 9,
              maxInputBytesPerItem: 4096,
              maxInputBytesTotal: total,
            },
            modelCalls: 0,
            toolRuns: 0,
            inputBytes: used,
          },
        });
      },
    );
  });

  describe("超出额度", () => {
    it.each<{ why: string; total: number; batches: number[]; used: number }>([
      { why: "第二段超了", total: 30, batches: [10, 21], used: 10 },
      {
        why: "★原子性：第一段就超，一个字节不记★",
        total: 10,
        batches: [11],
        used: 0,
      },
      { why: "用满之后再来一个字节", total: 30, batches: [30, 1], used: 30 },
    ])("$why｜上限 $total → used=$used", ({ total, batches, used }) => {
      expect(recordBytes(bytesStateOf(total), batches)).toEqual({
        ok: false,
        error: {
          kind: "insufficient-budget",
          limit: "input-bytes-total",
          used,
          max: total,
        },
      });
    });
  });

  describe("拒绝非法的字节数", () => {
    it.each<{ why: string; bytes: number }>([
      { why: "负数", bytes: -1 },
      { why: "小数", bytes: 2.5 },
      { why: "Infinity", bytes: Infinity },
      { why: "NaN", bytes: NaN },
      { why: "超出安全整数", bytes: 2 ** 53 },
    ])("$why｜bytes=$bytes", ({ bytes }) => {
      expect(recordInputBytes(bytesStateOf(100), bytes)).toEqual({
        ok: false,
        error: { kind: "invalid-count", value: bytes },
      });
    });
  });
});

// ══════════════════════════════════════════════════════════════
// 不变量：不是「某个输入 → 某个输出」，是「对所有输入都成立的性质」。
describe("不变量", () => {
  it("★纯函数★：调用之后，传进去的那个 state 一模一样", () => {
    const before = stateOf(3, 3);
    const snapshot = structuredClone(before);

    recordModelCall(before);
    recordToolRuns(before, 2);

    expect(before).toEqual(snapshot);
  });

  it("★两个计数器互不影响★", () => {
    const s0 = stateOf(3, 3);
    const afterModel = recordModelCall(s0);
    expect(afterModel).toEqual({
      ok: true,
      value: { limits: s0.limits, modelCalls: 1, toolRuns: 0, inputBytes: 0 },
    });
  });

  it("★撞上限不消耗状态★：模型额度满了，工具额度还能用", () => {
    const s = stateOf(1, 3);
    const used = recordModelCall(s);
    expect(used.ok).toBe(true);
    if (!used.ok) return;

    // 模型额度已满
    expect(recordModelCall(used.value)).toEqual({
      ok: false,
      error: {
        kind: "insufficient-budget",
        limit: "model-calls",
        used: 1,
        max: 1,
      },
    });
    // 工具额度不受影响
    expect(recordToolRuns(used.value, 3)).toEqual({
      ok: true,
      value: {
        limits: { maxModelCalls: 1, maxToolRuns: 3, ...BYTES_UNUSED },
        modelCalls: 1,
        toolRuns: 3,
        inputBytes: 0,
      },
    });
  });
});
