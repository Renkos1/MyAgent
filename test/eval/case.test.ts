/**
 * 判分点自己的测试。
 *
 * IMPORTANT: 每一条判分点都要有「过」和「不过」两个方向 ——
 * 只测过的那一边，一个恒返回 true 的实现会全绿。
 */
import { describe, expect, it } from "vitest";
import { describeCheck, judge } from "../../src/eval/case.ts";
import type { Check, Transcript } from "../../src/eval/case.ts";

/** 一份中规中矩的记录，各条测试只改自己关心的字段。 */
function tx(over: Partial<Transcript> = {}): Transcript {
  return {
    outcome: "done",
    answer: "docs 下有 README.md 和 MAP.md。",
    toolsUsed: ["list_files"],
    turns: 2,
    ...over,
  };
}

describe("judge · used-tool", () => {
  const c: Check = { kind: "used-tool", tool: "list_files" };

  it("调过就过", () => {
    expect(judge(c, tx())).toBe(true);
  });

  it("一个工具都没调，不过", () => {
    expect(judge(c, tx({ toolsUsed: [] }))).toBe(false);
  });

  it("调了别的工具，不过", () => {
    expect(judge(c, tx({ toolsUsed: ["read_file", "search"] }))).toBe(false);
  });

  it("调了很多次也算调过", () => {
    expect(
      judge(c, tx({ toolsUsed: ["list_files", "list_files", "list_files"] })),
    ).toBe(true);
  });
});

describe("judge · no-tool", () => {
  const c: Check = { kind: "no-tool", tool: "search" };

  it("没调过就过", () => {
    expect(judge(c, tx({ toolsUsed: ["list_files", "read_file"] }))).toBe(true);
  });

  it("空的也算没调过", () => {
    expect(judge(c, tx({ toolsUsed: [] }))).toBe(true);
  });

  it("调过一次就不过", () => {
    expect(judge(c, tx({ toolsUsed: ["list_files", "search"] }))).toBe(false);
  });
});

describe("judge · within-turns", () => {
  const c: Check = { kind: "within-turns", max: 2 };

  it("刚好等于上限，过", () => {
    expect(judge(c, tx({ turns: 2 }))).toBe(true);
  });

  it("少于上限，过", () => {
    expect(judge(c, tx({ turns: 1 }))).toBe(true);
  });

  it("多一轮就不过", () => {
    expect(judge(c, tx({ turns: 3 }))).toBe(false);
  });
});

describe("judge · answered", () => {
  const c: Check = { kind: "answered" };

  it("done 且答案非空，过", () => {
    expect(judge(c, tx())).toBe(true);
  });

  it("done 但答案是空串，不过", () => {
    // IMPORTANT: 这一条是 answered 的全部意义 —— runTurn 在 truncated/refused/empty
    //            之外也会走到 done 之外的分支把 text 置空，只看 outcome 会放过它
    expect(judge(c, tx({ answer: "" }))).toBe(false);
  });

  it("答案非空但 outcome 不是 done，不过", () => {
    expect(judge(c, tx({ outcome: "aborted" }))).toBe(false);
  });

  it("failed 也不过", () => {
    expect(judge(c, tx({ outcome: "failed" }))).toBe(false);
  });

  it("setup 也不过", () => {
    expect(judge(c, tx({ outcome: "setup" }))).toBe(false);
  });
});

describe("judge · mentions", () => {
  it("子串在里面就过", () => {
    expect(judge({ kind: "mentions", text: "README" }, tx())).toBe(true);
  });

  it("不在里面就不过", () => {
    expect(judge({ kind: "mentions", text: "CHANGELOG" }, tx())).toBe(false);
  });

  it("区分大小写", () => {
    expect(judge({ kind: "mentions", text: "readme" }, tx())).toBe(false);
  });

  it("答案是空串时任何非空子串都不过", () => {
    expect(judge({ kind: "mentions", text: "x" }, tx({ answer: "" }))).toBe(
      false,
    );
  });
});

describe("describeCheck", () => {
  it("五种判分点各有一句人话，互不相同", () => {
    const all: readonly Check[] = [
      { kind: "used-tool", tool: "search" },
      { kind: "no-tool", tool: "search" },
      { kind: "within-turns", max: 3 },
      { kind: "answered" },
      { kind: "mentions", text: "0012" },
    ];
    const said = all.map(describeCheck);
    expect(said).toEqual([
      "要调 search",
      "不该调 search",
      "不超过 3 轮",
      "要答出来",
      "答案里要有「0012」",
    ]);
    expect(new Set(said).size).toBe(5);
  });

  it("used-tool 和 no-tool 的措辞不能一样 —— 失败明细全靠它区分", () => {
    expect(describeCheck({ kind: "used-tool", tool: "read_file" })).not.toBe(
      describeCheck({ kind: "no-tool", tool: "read_file" }),
    );
  });
});
