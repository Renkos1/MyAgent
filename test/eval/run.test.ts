/**
 * 成绩单的测试。
 *
 * IMPORTANT: 这一层永远绿（退出码恒 0，ADR 0013 §④），所以它的「见红」不能
 * 靠「跑一遍看它过不过」。改成倒过来测：**喂一个故意答不对的被测对象，
 * 确认分数掉下来**。一个恒返回「全过」的 runEval 会死在这几条上。
 */
import { describe, expect, it } from "vitest";
import { runEval } from "../../src/eval/run.ts";
import type { Subject } from "../../src/eval/run.ts";
import type { EvalCase, Transcript } from "../../src/eval/case.ts";

const AT = (): Date => new Date("2026-09-06T00:00:00.000Z");

const CASES: readonly EvalCase[] = [
  {
    id: "one",
    question: "docs 下有什么？",
    expect: [{ kind: "used-tool", tool: "list_files" }, { kind: "answered" }],
    tags: [],
  },
  {
    id: "two",
    question: "你好",
    expect: [
      { kind: "no-tool", tool: "search" },
      { kind: "within-turns", max: 1 },
    ],
    tags: [],
  },
];

/** 什么都做对的被测对象。 */
const perfect: Subject = () =>
  Promise.resolve({
    outcome: "done",
    answer: "docs 下有 README.md",
    toolsUsed: ["list_files"],
    turns: 1,
  } satisfies Transcript);

/** 什么都不做的被测对象 —— 模型一句话没说。 */
const useless: Subject = () =>
  Promise.resolve({
    outcome: "aborted",
    answer: "",
    toolsUsed: [],
    turns: 4,
  } satisfies Transcript);

describe("runEval · 分数", () => {
  it("全对时 2/2，failures 是空数组", async () => {
    const r = await runEval(CASES, perfect, "perfect", AT);
    expect(r.passed).toBe(2);
    expect(r.total).toBe(2);
    expect(r.failures).toEqual([]);
  });

  it("故意答不对的被测对象拿 0/2 —— 这一条是这一层的见红", async () => {
    const r = await runEval(CASES, useless, "useless", AT);
    expect(r.passed).toBe(0);
    expect(r.total).toBe(2);
    expect(r.failures).toHaveLength(2);
  });

  it("部分对时只有挂掉的进 failures", async () => {
    // 答出来了，但一个工具都没调
    const lazy: Subject = () =>
      Promise.resolve({
        outcome: "done",
        answer: "我猜是两个文件",
        toolsUsed: [],
        turns: 1,
      } satisfies Transcript);
    const r = await runEval(CASES, lazy, "lazy", AT);
    expect(r.passed).toBe(1);
    expect(r.failures.map((f) => f.id)).toEqual(["one"]);
  });

  it("没有题目时是 0/0，不是崩", async () => {
    const r = await runEval([], perfect, "perfect", AT);
    expect(r).toMatchObject({ passed: 0, total: 0, failures: [] });
  });
});

describe("runEval · 失败明细", () => {
  it("逐条记挂掉的判分点，不是只说「这道题挂了」", async () => {
    const r = await runEval(CASES, useless, "useless", AT);
    expect(r.failures[0]).toEqual({
      id: "one",
      passed: false,
      failed: ["要调 list_files", "要答出来"],
    });
  });

  it("过了的判分点不进 failed", async () => {
    const r = await runEval(CASES, useless, "useless", AT);
    // 第二道题的 no-tool search 是过的，只有 within-turns 挂
    expect(r.failures[1]).toEqual({
      id: "two",
      passed: false,
      failed: ["不超过 1 轮"],
    });
  });
});

describe("runEval · 被测对象炸了", () => {
  it("那道题记 0 分，不中断整组", async () => {
    let n = 0;
    const flaky: Subject = (q) => {
      n += 1;
      if (n === 1) return Promise.reject(new Error("连不上"));
      return perfect(q);
    };
    const r = await runEval(CASES, flaky, "flaky", AT);
    expect(r.total).toBe(2);
    expect(r.passed).toBe(1);
    expect(r.failures[0]?.failed).toEqual(["被测对象抛了：连不上"]);
  });

  it("抛的不是 Error 也要记下来", async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- 测的就是"抛的不是 Error"这一支
    const weird: Subject = () => Promise.reject("字符串");
    const r = await runEval(CASES.slice(0, 1), weird, "weird", AT);
    expect(r.failures[0]?.failed).toEqual(["被测对象抛了：字符串"]);
  });
});

describe("runEval · 元信息", () => {
  it("时钟是注入的 —— 不注入这条断言就写不出来", async () => {
    const r = await runEval(CASES, perfect, "perfect", AT);
    expect(r.at).toBe("2026-09-06T00:00:00.000Z");
  });

  it("被测对象的名字原样进成绩单", async () => {
    const r = await runEval(CASES, perfect, "claude-opus-5", AT);
    expect(r.subject).toBe("claude-opus-5");
  });

  it("成绩单里没有模型的完整输出（ADR 0013 §③）", async () => {
    const long: Subject = () =>
      Promise.resolve({
        outcome: "done",
        answer: "这段很长的原文不该出现在成绩单里",
        toolsUsed: [],
        turns: 9,
      } satisfies Transcript);
    const r = await runEval(CASES, long, "long", AT);
    expect(JSON.stringify(r)).not.toContain("这段很长的原文");
  });
});

describe("runEval · 串行", () => {
  it("一道一道跑，任何时刻只有一个在飞", async () => {
    // NOTE: 「串行」在返回值里看不见 —— 只能靠被测对象自己量，
    //       同 FakeTools.peakConcurrency。
    let running = 0;
    let peak = 0;
    const slow: Subject = async (q) => {
      running += 1;
      peak = Math.max(peak, running);
      for (let i = 0; i < 3; i++) await Promise.resolve();
      running -= 1;
      return perfect(q);
    };
    await runEval(CASES, slow, "slow", AT);
    expect(peak).toBe(1);
  });

  it("按题目顺序问，不按完成顺序", async () => {
    const asked: string[] = [];
    const spy: Subject = async (q) => {
      asked.push(q);
      return perfect(q);
    };
    await runEval(CASES, spy, "spy", AT);
    expect(asked).toEqual(["docs 下有什么？", "你好"]);
  });
});
