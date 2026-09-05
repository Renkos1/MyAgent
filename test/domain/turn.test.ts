import { describe, expect, it } from "vitest";

import type { TurnOutcome } from "../../src/domain/turn.ts";
import { decide } from "../../src/domain/turn.ts";

describe("decide", () => {
  // ══════════════════════════════════════════════════════════════
  // ★2026-09 契约变更：decide 不再检查预算（turn.ts 契约③）。★
  // 删掉的 10 条，去向都在这里 —— ★不是丢了，是搬家了★：
  //
  //   已经有等价覆盖，删掉不损失（证据在 loop.test.ts）
  //     模型额度用光 → aborted(model-calls)   ≡ loop.test「上限 $max，调 $times 次 → 拒绝」
  //     工具额度用光 → aborted(tool-runs)     ≡ loop.test「$why｜上限 $max，批次 $batches」
  //     3 条原子性用例                        ≡ loop.test 同一张表里的原子性行
  //
  //   ★搬到用例层，等 test/app/runTurn.test.ts 来接（还没人写）★
  //     ① 两个额度都不够 → 报哪个
  //        ⚠ ★期望值变了★：阶段 1 是 tool-runs，现在是 model-calls
  //          （runTurn 契约④：模型预算在轮首扣，工具预算只能在 continue 之后扣）
  //     ② 预算用光 + completed → ★仍然是 done★
  //        这条在 decide 这一层已经恒真（它看不到预算），但契约本身还活着，
  //        只能在 runTurn 上验：最后一次可负担的调用里模型说完了，要给答案不给失败
  //
  //   纯粹恒真、删掉
  //     「调用之后 state 一模一样」—— 签名里已经没有 state 了，由类型保证
  // ══════════════════════════════════════════════════════════════
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
      expect(decide(outcome)).toEqual(decision);
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
      // ⚠ ★这张表现在只有 toolCount 一列还有鉴别力★：
      //   decide 收不到预算了，模型/工具那四列不再影响结果。
      //   保留是因为行还在跑不同的 toolCount —— ★但它已经不是原来那个测试了★。
      ({ toolCount }) => {
        expect(decide({ kind: "tool-requested", toolCount })).toEqual({
          kind: "continue",
          toolRuns: toolCount,
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
      expect(decide({ kind: "tool-requested", toolCount })).toEqual({
        kind: "aborted",
        reason: { kind: "invalid-count", value: toolCount },
      });
    });
  });

  // ══════════════════════════════════════════════════════════════

  describe("不变量", () => {
    it("★同样输入永远同样输出★：连调三次结果相同", () => {
      const outcome: TurnOutcome = { kind: "tool-requested", toolCount: 2 };
      const results = [decide(outcome), decide(outcome), decide(outcome)];
      expect(results).toEqual([results[0], results[0], results[0]]);
      expect(results[0]).toEqual({ kind: "continue", toolRuns: 2 });
    });

    it("★continue 时报的 toolRuns 就是请求的个数★，不多不少", () => {
      const counts = [1, 2, 3, 4, 5];
      const reported = counts.map((n) => {
        const d = decide({ kind: "tool-requested", toolCount: n });
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
      expect(all.map((o) => decide(o).kind)).toEqual([
        "done",
        "aborted",
        "aborted",
        "aborted",
        "continue",
      ]);
    });
  });
});
