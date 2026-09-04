import { describe, expect, it } from "vitest";

import type { LoopBudget } from "../../src/domain/loop.ts";
import {
  createLoopBudget,
  recordModelCall,
  recordToolRuns,
} from "../../src/domain/loop.ts";
import type { TurnOutcome } from "../../src/domain/turn.ts";
import { decide } from "../../src/domain/turn.ts";

const BYTES = { maxInputBytesPerItem: 4096, maxInputBytesTotal: 65536 };

/**
 * 造一个「已经用掉一些额度」的状态。
 * ★只能通过真实的转换函数推进★ —— 品牌类型不许直接拼 LoopBudget，
 * 这反过来保证脚手架造出来的状态是循环里真会出现的形状。
 */
function stateWith(opts: {
  maxModelCalls: number;
  maxToolRuns: number;
  modelCalls?: number;
  toolRuns?: number;
}): LoopBudget {
  const created = createLoopBudget({
    maxModelCalls: opts.maxModelCalls,
    maxToolRuns: opts.maxToolRuns,
    ...BYTES,
  });
  if (!created.ok) throw new Error(`脚手架：上限非法 ${created.error.limit}`);

  let state = created.value;
  for (let i = 0; i < (opts.modelCalls ?? 0); i++) {
    const r = recordModelCall(state);
    if (!r.ok) throw new Error("脚手架：模型额度不够，用例参数写错了");
    state = r.value;
  }
  if (opts.toolRuns) {
    const r = recordToolRuns(state, opts.toolRuns);
    if (!r.ok) throw new Error("脚手架：工具额度不够，用例参数写错了");
    state = r.value;
  }
  return state;
}

/** 额度充裕的状态，用在"预算不参与鉴别"的用例里。 */
const ROOMY = stateWith({ maxModelCalls: 9, maxToolRuns: 9 });

describe("decide", () => {
  // ══════════════════════════════════════════════════════════════
  // 与预算无关的四个 outcome
  describe("outcome 本身就决定结局（预算充裕）", () => {
    it.each<{ why: string; outcome: TurnOutcome; decision: unknown }>([
      {
        why: "模型说完了 → 成功",
        outcome: { kind: "completed" },
        decision: { kind: "done" },
      },
      {
        why: "★输出被截断 → 失败★，半句话不是答案",
        outcome: { kind: "truncated" },
        decision: { kind: "aborted", reason: { kind: "truncated" } },
      },
      {
        why: "供应商拒绝 → 失败",
        outcome: { kind: "refused" },
        decision: { kind: "aborted", reason: { kind: "refused" } },
      },
      {
        why: "★空响应 → 失败★，再问一次也是活锁",
        outcome: { kind: "empty" },
        decision: { kind: "aborted", reason: { kind: "empty-response" } },
      },
    ])("$why", ({ outcome, decision }) => {
      expect(decide(ROOMY, outcome)).toEqual(decision);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // ★这一组是契约③的核心：同样的状态，outcome 不同，结局相反★
  describe("★优先级★：预算用光时，completed 仍然是成功", () => {
    // 三个状态都已经把某项额度用到顶
    const modelExhausted = stateWith({
      maxModelCalls: 2,
      maxToolRuns: 9,
      modelCalls: 2,
    });
    const toolExhausted = stateWith({
      maxModelCalls: 9,
      maxToolRuns: 3,
      toolRuns: 3,
    });

    it("模型额度用光 + completed → ★done，不是 aborted★", () => {
      expect(decide(modelExhausted, { kind: "completed" })).toEqual({
        kind: "done",
      });
    });

    it("工具额度用光 + completed → ★done★", () => {
      expect(decide(toolExhausted, { kind: "completed" })).toEqual({
        kind: "done",
      });
    });

    // 对照组：同一个状态，模型要继续 → 就是失败
    it("模型额度用光 + 要调工具 → aborted(model-calls)", () => {
      expect(
        decide(modelExhausted, { kind: "tool-requested", toolCount: 1 }),
      ).toEqual({
        kind: "aborted",
        reason: {
          kind: "insufficient-budget",
          limit: "model-calls",
          used: 2,
          max: 2,
        },
      });
    });

    it("工具额度用光 + 要调工具 → aborted(tool-runs)", () => {
      expect(
        decide(toolExhausted, { kind: "tool-requested", toolCount: 1 }),
      ).toEqual({
        kind: "aborted",
        reason: {
          kind: "insufficient-budget",
          limit: "tool-runs",
          used: 3,
          max: 3,
        },
      });
    });

    // ★两个都不够时的顺序：工具优先（近的先查）★
    it("★两个额度都不够 → 报 tool-runs★", () => {
      const both = stateWith({
        maxModelCalls: 2,
        maxToolRuns: 3,
        modelCalls: 2,
        toolRuns: 3,
      });
      expect(decide(both, { kind: "tool-requested", toolCount: 1 })).toEqual({
        kind: "aborted",
        reason: {
          kind: "insufficient-budget",
          limit: "tool-runs",
          used: 3,
          max: 3,
        },
      });
    });
  });

  // ══════════════════════════════════════════════════════════════
  describe("要调工具，额度够 → continue", () => {
    it.each<{
      why: string;
      maxModelCalls: number;
      maxToolRuns: number;
      modelCalls: number;
      toolRuns: number;
      toolCount: number;
    }>([
      {
        why: "全新状态，要一个工具",
        maxModelCalls: 9,
        maxToolRuns: 9,
        modelCalls: 0,
        toolRuns: 0,
        toolCount: 1,
      },
      {
        why: "并行三个工具",
        maxModelCalls: 9,
        maxToolRuns: 9,
        modelCalls: 1,
        toolRuns: 0,
        toolCount: 3,
      },
      {
        why: "★工具额度正好用完★",
        maxModelCalls: 9,
        maxToolRuns: 5,
        modelCalls: 1,
        toolRuns: 2,
        toolCount: 3,
      },
      {
        why: "★模型额度还剩最后一次★",
        maxModelCalls: 3,
        maxToolRuns: 9,
        modelCalls: 2,
        toolRuns: 0,
        toolCount: 1,
      },
    ])(
      "$why｜模型 $modelCalls/$maxModelCalls，工具 $toolRuns/$maxToolRuns，要 $toolCount 个",
      ({ maxModelCalls, maxToolRuns, modelCalls, toolRuns, toolCount }) => {
        const state = stateWith({
          maxModelCalls,
          maxToolRuns,
          modelCalls,
          toolRuns,
        });
        expect(decide(state, { kind: "tool-requested", toolCount })).toEqual({
          kind: "continue",
          toolRuns: toolCount,
        });
      },
    );
  });

  describe("要调工具，额度不够 → aborted", () => {
    it.each<{
      why: string;
      maxToolRuns: number;
      toolRuns: number;
      toolCount: number;
      used: number;
    }>([
      {
        why: "★只超一个★",
        maxToolRuns: 5,
        toolRuns: 2,
        toolCount: 4,
        used: 2,
      },
      {
        why: "★原子性：额度剩 2，来 3 个 → 一个都不跑，used 停在 3★",
        maxToolRuns: 5,
        toolRuns: 3,
        toolCount: 3,
        used: 3,
      },
      {
        why: "全新状态就要得太多",
        maxToolRuns: 2,
        toolRuns: 0,
        toolCount: 3,
        used: 0,
      },
    ])(
      "$why｜工具 $toolRuns/$maxToolRuns，要 $toolCount 个",
      ({ maxToolRuns, toolRuns, toolCount, used }) => {
        const state = stateWith({
          maxModelCalls: 9,
          maxToolRuns,
          toolRuns,
        });
        expect(decide(state, { kind: "tool-requested", toolCount })).toEqual({
          kind: "aborted",
          reason: {
            kind: "insufficient-budget",
            limit: "tool-runs",
            used,
            max: maxToolRuns,
          },
        });
      },
    );
  });

  // ══════════════════════════════════════════════════════════════
  describe("toolCount 非法 → 适配器出了问题", () => {
    it.each<{ why: string; toolCount: number }>([
      // ★0 在这里非法★：说要调工具，个数却是 0 —— 自相矛盾。
      // 对照 1.3 的 recordInputBytes，那里 bytes=0 是合法的（空文件真实存在）。
      { why: "★说要调工具却是 0 个★", toolCount: 0 },
      { why: "负数", toolCount: -1 },
      { why: "小数", toolCount: 1.5 },
      { why: "Infinity", toolCount: Infinity },
      { why: "NaN", toolCount: NaN },
      { why: "超出安全整数", toolCount: 2 ** 53 },
    ])("$why｜toolCount=$toolCount", ({ toolCount }) => {
      expect(decide(ROOMY, { kind: "tool-requested", toolCount })).toEqual({
        kind: "aborted",
        reason: { kind: "invalid-count", value: toolCount },
      });
    });

    it("★非法个数比额度检查更早★：额度也不够时仍报 invalid-count", () => {
      const noRoom = stateWith({
        maxModelCalls: 1,
        maxToolRuns: 1,
        modelCalls: 1,
        toolRuns: 1,
      });
      expect(decide(noRoom, { kind: "tool-requested", toolCount: 0 })).toEqual({
        kind: "aborted",
        reason: { kind: "invalid-count", value: 0 },
      });
    });
  });

  // ══════════════════════════════════════════════════════════════
  describe("不变量", () => {
    it("★纯判定★：调用之后 state 一模一样", () => {
      const before = stateWith({ maxModelCalls: 3, maxToolRuns: 3 });
      const snapshot = structuredClone(before);
      decide(before, { kind: "completed" });
      decide(before, { kind: "tool-requested", toolCount: 2 });
      decide(before, { kind: "truncated" });
      expect(before).toEqual(snapshot);
    });

    it("★同样输入永远同样输出★：连调三次结果相同", () => {
      const state = stateWith({ maxModelCalls: 3, maxToolRuns: 3 });
      const outcome: TurnOutcome = { kind: "tool-requested", toolCount: 2 };
      const results = [
        decide(state, outcome),
        decide(state, outcome),
        decide(state, outcome),
      ];
      expect(results).toEqual([results[0], results[0], results[0]]);
      expect(results[0]).toEqual({ kind: "continue", toolRuns: 2 });
    });

    it("★continue 时报的 toolRuns 就是请求的个数★，不多不少", () => {
      const state = stateWith({ maxModelCalls: 9, maxToolRuns: 9 });
      const counts = [1, 2, 3, 4, 5];
      const reported = counts.map((n) => {
        const d = decide(state, { kind: "tool-requested", toolCount: n });
        return d.kind === "continue" ? d.toolRuns : null;
      });
      expect(reported).toEqual(counts);
    });

    it("★五个 outcome 每一个都有归宿★ —— 没有 undefined 漏网", () => {
      const all: TurnOutcome[] = [
        { kind: "completed" },
        { kind: "truncated" },
        { kind: "refused" },
        { kind: "empty" },
        { kind: "tool-requested", toolCount: 1 },
      ];
      expect(all.map((o) => decide(ROOMY, o).kind)).toEqual([
        "done",
        "aborted",
        "aborted",
        "aborted",
        "continue",
      ]);
    });
  });
});
