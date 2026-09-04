import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { LoopState } from "../../src/domain/loop.ts";
import {
  createLoopState,
  recordInputBytes,
  recordModelCall,
  recordToolRuns,
} from "../../src/domain/loop.ts";

const RUNS = { numRuns: 500 };

/** 一次预算操作。三种转换函数各一个。 */
type Op =
  | { readonly t: "model" }
  | { readonly t: "tools"; readonly n: number }
  | { readonly t: "bytes"; readonly n: number };

const anyOp: fc.Arbitrary<Op> = fc.oneof(
  fc.constant<Op>({ t: "model" }),
  fc.integer({ min: 1, max: 5 }).map((n): Op => ({ t: "tools", n })),
  fc.nat({ max: 300 }).map((n): Op => ({ t: "bytes", n })),
);

/** 上限本身也随机 —— 别只在一组固定上限下测。 */
const anyLimits = fc.record({
  maxModelCalls: fc.integer({ min: 1, max: 8 }),
  maxToolRuns: fc.integer({ min: 1, max: 12 }),
  maxInputBytesPerItem: fc.integer({ min: 1, max: 500 }),
  maxInputBytesTotal: fc.integer({ min: 1, max: 1000 }),
});
type Limits = ReturnType<(typeof anyLimits)["generate"]>["value"];

function freshState(limits: Limits): LoopState {
  const r = createLoopState(limits);
  if (!r.ok) throw new Error(`脚手架：生成器造出了非法上限 ${r.error.limit}`);
  return r.value;
}

/** 执行一步。★失败时返回原状态★ —— 转换函数失败不消耗任何额度。 */
function apply(state: LoopState, o: Op): LoopState {
  const r =
    o.t === "model"
      ? recordModelCall(state)
      : o.t === "tools"
        ? recordToolRuns(state, o.n)
        : recordInputBytes(state, o.n);
  return r.ok ? r.value : state;
}

/** 执行一串操作，失败的跳过。返回每一步的状态（含初始态）。 */
function trace(state: LoopState, ops: readonly Op[]): LoopState[] {
  const seen = [state];
  let cur = state;
  for (const o of ops) {
    cur = apply(cur, o);
    seen.push(cur);
  }
  return seen;
}

describe("预算状态机的性质", () => {
  // ★这一条是整个模块存在的理由★：无论怎么操作，都不可能越界。
  it("★任意操作序列，三个计数器永不超过各自上限★", () => {
    fc.assert(
      fc.property(anyLimits, fc.array(anyOp, { maxLength: 30 }), (lim, ops) => {
        const over = trace(freshState(lim), ops).filter(
          (s) =>
            s.modelCalls > lim.maxModelCalls ||
            s.toolRuns > lim.maxToolRuns ||
            s.inputBytes > lim.maxInputBytesTotal,
        );
        expect(over).toEqual([]);
      }),
      RUNS,
    );
  });

  it("★单调不减★：计数器只会涨，不会退", () => {
    fc.assert(
      fc.property(anyLimits, fc.array(anyOp, { maxLength: 30 }), (lim, ops) => {
        const backwards: string[] = [];
        let prev = freshState(lim);
        for (const o of ops) {
          const cur = apply(prev, o);
          if (
            cur.modelCalls < prev.modelCalls ||
            cur.toolRuns < prev.toolRuns ||
            cur.inputBytes < prev.inputBytes
          ) {
            backwards.push(JSON.stringify(o));
          }
          prev = cur;
        }
        expect(backwards).toEqual([]);
      }),
      RUNS,
    );
  });

  it("★一次操作只动一个计数器★：另外两个纹丝不动", () => {
    fc.assert(
      fc.property(anyLimits, anyOp, (lim, o) => {
        const s = freshState(lim);
        const after = apply(s, o);
        const moved = [
          after.modelCalls !== s.modelCalls,
          after.toolRuns !== s.toolRuns,
          after.inputBytes !== s.inputBytes,
        ].filter(Boolean).length;
        expect(moved).toBeLessThanOrEqual(1);
      }),
      RUNS,
    );
  });

  it("★上限本身永远不被改动★", () => {
    fc.assert(
      fc.property(anyLimits, fc.array(anyOp, { maxLength: 30 }), (lim, ops) => {
        const seen = trace(freshState(lim), ops);
        expect(seen.map((s) => s.limits)).toEqual(seen.map(() => lim));
      }),
      RUNS,
    );
  });

  it("★纯函数★：转换不改动传进去的状态", () => {
    fc.assert(
      fc.property(anyLimits, anyOp, (lim, o) => {
        const s = freshState(lim);
        const snapshot = structuredClone(s);
        apply(s, o);
        expect(s).toEqual(snapshot);
      }),
      RUNS,
    );
  });
});

// ══════════════════════════════════════════════════════════════
// ★一条"不成立"的性质★ —— 它不成立，正是契约⑥（原子性）的直接后果。
// 写下"这条不成立、因为契约第几条"，和写下成立的性质一样有价值。
describe("★结合律：额度够时成立，不够时不成立★", () => {
  const nTools = fc.integer({ min: 1, max: 6 });

  /** 逐个记 n 次，每次一个。 */
  function oneByOne(state: LoopState, n: number): LoopState {
    let cur = state;
    for (let i = 0; i < n; i++) {
      const r = recordToolRuns(cur, 1);
      if (!r.ok) break;
      cur = r.value;
    }
    return cur;
  }

  it("额度充足时：recordToolRuns(s, n) ≡ 连续 n 次 recordToolRuns(s, 1)", () => {
    fc.assert(
      fc.property(anyLimits, nTools, (lim, n) => {
        const s = freshState(lim);
        const batch = recordToolRuns(s, n);
        // fc.pre 已经把 batch 收窄成 ok 分支，不必再判一次
        fc.pre(batch.ok);
        expect(oneByOne(s, n)).toEqual(batch.value);
      }),
      RUNS,
    );
  });

  it("★额度不足时：两者不等价★ —— 批量一个不跑，逐个会跑满", () => {
    fc.assert(
      fc.property(anyLimits, nTools, (lim, n) => {
        const s = freshState(lim);
        const batch = recordToolRuns(s, n);
        // 只看"批量被拒、但还剩至少一个额度"的情况
        fc.pre(!batch.ok && n > lim.maxToolRuns);

        // 批量：状态没动
        expect(batch.ok).toBe(false);
        // 逐个：一路跑到用满
        expect(oneByOne(s, n).toolRuns).toBe(lim.maxToolRuns);
      }),
      RUNS,
    );
  });
});
