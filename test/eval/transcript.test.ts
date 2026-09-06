/**
 * seam 的测试：run 的事件流 + 返回值 → 判分点看得见的那一小块。
 *
 * IMPORTANT: 这里丢掉的信息，判分点就永远判不了 —— 所以「丢了什么」本身要有断言。
 */
import { describe, expect, it } from "vitest";
import { toTranscript } from "../../src/eval/transcript.ts";
import type { RunEvent, RunResult } from "../../src/app/runTurn.ts";
import type { LoopBudget } from "../../src/domain/loop.ts";

const BUDGET = {
  limits: {
    maxModelCalls: 4,
    maxToolRuns: 4,
    maxInputBytesPerItem: 4096,
    maxInputBytesTotal: 65536,
  },
  modelCalls: 2,
  toolRuns: 2,
  inputBytes: 100,
} as unknown as LoopBudget;

const DONE: RunResult = { kind: "done", text: "答案", budget: BUDGET };

describe("toTranscript · turns", () => {
  it("数的是 turn-started，不是事件总数", () => {
    const events: readonly RunEvent[] = [
      { kind: "turn-started", turn: 1 },
      { kind: "tool-started", call: { name: "list_files", id: "a", dir: "d" } },
      { kind: "retrying", attempt: 1, afterMs: 10 },
      { kind: "turn-started", turn: 2 },
    ];
    expect(toTranscript(events, DONE).turns).toBe(2);
  });

  it("没有事件时是 0", () => {
    expect(toTranscript([], DONE).turns).toBe(0);
  });

  it("工具事件不计进轮次 —— 一轮里调三个工具还是一轮", () => {
    const events: readonly RunEvent[] = [
      { kind: "turn-started", turn: 1 },
      { kind: "tool-started", call: { name: "list_files", id: "a", dir: "d" } },
      { kind: "tool-started", call: { name: "read_file", id: "b", path: "p" } },
      { kind: "tool-started", call: { name: "search", id: "c", query: "q" } },
    ];
    expect(toTranscript(events, DONE).turns).toBe(1);
  });
});

describe("toTranscript · toolsUsed", () => {
  it("按发起顺序，不去重", () => {
    const events: readonly RunEvent[] = [
      { kind: "tool-started", call: { name: "read_file", id: "a", path: "p" } },
      { kind: "tool-started", call: { name: "list_files", id: "b", dir: "d" } },
      { kind: "tool-started", call: { name: "read_file", id: "c", path: "q" } },
    ];
    expect(toTranscript(events, DONE).toolsUsed).toEqual([
      "read_file",
      "list_files",
      "read_file",
    ]);
  });

  it("数的是 tool-started 不是 tool-finished —— 发起了没跑完也算发起过", () => {
    const call = { name: "search", id: "a", query: "q" } as const;
    const events: readonly RunEvent[] = [
      { kind: "tool-started", call },
      { kind: "tool-finished", call, outcome: { kind: "aborted" } },
    ];
    expect(toTranscript(events, DONE).toolsUsed).toEqual(["search"]);
  });
});

describe("toTranscript · answer 和 outcome", () => {
  it("done 时带上文本", () => {
    const t = toTranscript([], {
      kind: "done",
      text: "两个文件",
      budget: BUDGET,
    });
    expect(t).toMatchObject({ outcome: "done", answer: "两个文件" });
  });

  it("aborted 时 answer 是空串，不是 undefined", () => {
    const t = toTranscript([], {
      kind: "aborted",
      reason: { kind: "refused" },
      budget: BUDGET,
    });
    expect(t).toMatchObject({ outcome: "aborted", answer: "" });
  });

  it("failed 时同样是空串", () => {
    const t = toTranscript([], {
      kind: "failed",
      error: { kind: "malformed" },
      budget: BUDGET,
    });
    expect(t).toMatchObject({ outcome: "failed", answer: "" });
  });

  it("setup 时同样是空串", () => {
    const t = toTranscript([], {
      kind: "setup",
      error: { kind: "ill-formed", index: 0 },
    });
    expect(t).toMatchObject({ outcome: "setup", answer: "" });
  });
});

describe("toTranscript · 投影丢掉了什么", () => {
  it("预算、重试、工具结果都不在观测面上", () => {
    const call = { name: "read_file", id: "a", path: "p" } as const;
    const t = toTranscript(
      [
        { kind: "retrying", attempt: 3, afterMs: 800 },
        { kind: "tool-started", call },
        {
          kind: "tool-finished",
          call,
          outcome: { kind: "too-large", bytes: 9, max: 8 },
        },
        { kind: "input-truncated", index: 0 },
      ],
      DONE,
    );
    // IMPORTANT: 这条断言写死了 eval 层的判分上限。要判重试次数或工具结果，
    //            先改 toTranscript，不要在判分点那边想办法绕。
    expect(Object.keys(t).sort()).toEqual([
      "answer",
      "outcome",
      "toolsUsed",
      "turns",
    ]);
  });
});
