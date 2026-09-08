/**
 * 线格式的词汇表（ADR 0021 D1）。
 *
 * IMPORTANT: 这里断言的是**对外契约**，所以断言写得比别处死 ——
 * 事件名和字段名改一个字就该红，因为客户端是照着这些字符串解析的。
 */
import { describe, expect, it } from "vitest";

import type { RunEvent, RunResult } from "../../src/app/runTurn.ts";
import { toTerminal, toWire } from "../../src/infra/http/wire.ts";
import { stateWith } from "../helpers/budget.ts";

const CALL = { name: "list_files" as const, id: "t1", dir: "docs" };
const BUDGET = stateWith({ maxModelCalls: 9, maxToolRuns: 9, modelCalls: 2 });

describe("toWire：每一种用例层事件都有确定的线格式", () => {
  it.each<[string, RunEvent, unknown]>([
    [
      "turn-started",
      { kind: "turn-started", turn: 3 },
      { event: "turn", data: { turn: 3 } },
    ],
    [
      "text",
      { kind: "text", delta: "两" },
      { event: "delta", data: { text: "两" } },
    ],
    [
      "tool-started",
      { kind: "tool-started", call: CALL },
      {
        event: "tool",
        data: { phase: "started", id: "t1", name: "list_files" },
      },
    ],
    [
      "tool-finished",
      {
        kind: "tool-finished",
        call: CALL,
        outcome: { kind: "ok", content: "README.md" },
      },
      {
        event: "tool",
        data: {
          phase: "finished",
          id: "t1",
          name: "list_files",
          outcome: "ok",
        },
      },
    ],
    [
      "retrying",
      { kind: "retrying", attempt: 2, afterMs: 1000 },
      { event: "retry", data: { attempt: 2, afterMs: 1000 } },
    ],
    [
      "input-truncated",
      { kind: "input-truncated", index: 0 },
      { event: "truncated", data: { index: 0 } },
    ],
  ])("%s", (_name, event, wire) => {
    expect(toWire(event)).toEqual(wire);
  });

  it("SAFETY: 工具结果的内容不上线 —— 只有 kind", () => {
    const wire = toWire({
      kind: "tool-finished",
      call: CALL,
      outcome: { kind: "ok", content: "机密的文件内容" },
    });
    expect(JSON.stringify(wire)).not.toContain("机密");
  });
});

describe("toTerminal：谁配拿到终止事件", () => {
  it("done → stop: done，带预算", () => {
    const r: RunResult = { kind: "done", text: "两个文件", budget: BUDGET };
    expect(toTerminal(r)).toEqual({
      event: "done",
      data: {
        stop: "done",
        budget: { modelCalls: 2, toolRuns: 0, inputBytes: 0 },
      },
    });
  });

  it("done 里不重复答案全文 —— 拼 delta 是客户端的活", () => {
    const r: RunResult = { kind: "done", text: "两个文件", budget: BUDGET };
    expect(JSON.stringify(toTerminal(r))).not.toContain("两个文件");
  });

  it("领域拒绝 → stop: aborted，带是哪条规则挡的", () => {
    const r: RunResult = {
      kind: "aborted",
      reason: { kind: "refused" },
      budget: BUDGET,
    };
    expect(toTerminal(r)).toEqual({
      event: "done",
      data: {
        stop: "aborted",
        reason: "refused",
        budget: { modelCalls: 2, toolRuns: 0, inputBytes: 0 },
      },
    });
  });

  it.each<[string, RunResult]>([
    ["failed", { kind: "failed", error: { kind: "rejected" }, budget: BUDGET }],
    [
      "setup",
      {
        kind: "setup",
        error: { kind: "item-too-large", index: 0, bytes: 99, max: 10 },
      },
    ],
  ])("%s → null（这两种不走终止事件这条路）", (_name, r) => {
    expect(toTerminal(r)).toBeNull();
  });
});
