/**
 * 题库校验的测试。
 *
 * IMPORTANT: 题库是外部输入 —— 少一个字段不会报错，只会变成 undefined 一路
 * 流进判分点，然后判出一个看起来很正常的分数。这一层的每一条拒绝都要见过红。
 */
import { describe, expect, it } from "vitest";
import { parseCases } from "../../src/eval/parse.ts";

/** 一道合法的题，各条测试只改自己关心的那一处。 */
function good(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "one",
    question: "docs 下有什么？",
    expect: [{ kind: "answered" }],
    tags: ["smoke"],
    ...over,
  };
}

/** 取错误里的 at，方便断言。 */
function ats(r: ReturnType<typeof parseCases>): readonly string[] {
  return r.ok ? [] : r.error.map((e) => e.at);
}

describe("parseCases · 收得进来的", () => {
  it("一道完整的题原样收进来", () => {
    const r = parseCases([good()]);
    expect(r.ok && r.value).toEqual([
      {
        id: "one",
        question: "docs 下有什么？",
        expect: [{ kind: "answered" }],
        tags: ["smoke"],
      },
    ]);
  });

  it("空数组是合法题库", () => {
    const r = parseCases([]);
    expect(r.ok && r.value).toEqual([]);
  });

  it("tags 可以是空数组", () => {
    expect(parseCases([good({ tags: [] })]).ok).toBe(true);
  });

  it("五种判分点原样收进来 —— 断言的是内容，不是「收进来了 5 个」", () => {
    // IMPORTANT: 上一版这里写的是 toHaveLength(5)，变异测试当场指出
    //            readCheck 的每一个返回对象换成 {} 都不会红：
    //            数得对不等于收得对。
    const checks = [
      { kind: "used-tool", tool: "list_files" },
      { kind: "no-tool", tool: "search" },
      { kind: "within-turns", max: 3 },
      { kind: "answered" },
      { kind: "mentions", text: "0012" },
    ];
    const r = parseCases([good({ expect: checks })]);
    expect(r.ok && r.value[0]?.expect).toEqual(checks);
  });

  it("used-tool 和 no-tool 收出来是两个不同的 kind", () => {
    const r = parseCases([
      good({
        expect: [
          { kind: "used-tool", tool: "search" },
          { kind: "no-tool", tool: "search" },
        ],
      }),
    ]);
    expect(r.ok && r.value[0]?.expect).toEqual([
      { kind: "used-tool", tool: "search" },
      { kind: "no-tool", tool: "search" },
    ]);
  });

  it("多余的字段被丢掉，不原样带进来", () => {
    const r = parseCases([good({ note: "随手写的备注" })]);
    expect(r.ok && Object.keys(r.value[0] ?? {}).sort()).toEqual([
      "expect",
      "id",
      "question",
      "tags",
    ]);
  });
});

describe("parseCases · 整体形状", () => {
  it("根不是数组就拒", () => {
    expect(parseCases({ cases: [] }).ok).toBe(false);
  });

  it("null 也拒", () => {
    expect(parseCases(null).ok).toBe(false);
  });

  it("题目不是对象就拒", () => {
    expect(ats(parseCases(["一道题"]))).toEqual(["[0]"]);
  });

  it("题目是 null 时拒，不是崩", () => {
    // TRAP: typeof null === "object"。isRecord 里那句 v !== null 就是为它写的，
    //       而在补这一条之前，没有任何测试传过 null —— 同 tape 那个 body === null。
    expect(ats(parseCases([null]))).toEqual(["[0]"]);
  });

  it("判分点是 null 时拒，不是崩", () => {
    expect(ats(parseCases([good({ expect: [null] })]))).toEqual([
      "[0].expect[0]",
    ]);
  });
});

describe("parseCases · 字段", () => {
  it.each([
    ["id 缺", { id: undefined }, "[0].id"],
    ["id 是空串", { id: "" }, "[0].id"],
    ["id 不是字符串", { id: 7 }, "[0].id"],
    ["question 缺", { question: undefined }, "[0].question"],
    ["question 是空串", { question: "" }, "[0].question"],
    ["expect 缺", { expect: undefined }, "[0].expect"],
    ["expect 是空数组", { expect: [] }, "[0].expect"],
    ["expect 不是数组", { expect: { kind: "answered" } }, "[0].expect"],
    ["tags 缺", { tags: undefined }, "[0].tags"],
    ["tags 不是数组", { tags: "smoke" }, "[0].tags"],
    ["tags 里混了非字符串", { tags: ["a", 1] }, "[0].tags"],
  ])("%s → 点名 %s", (_name, over, at) => {
    expect(ats(parseCases([good(over)]))).toContain(at);
  });
});

describe("parseCases · 判分点", () => {
  it.each([
    ["没有这种 kind", { kind: "vibes" }, "[0].expect[0].kind"],
    ["kind 缺", {}, "[0].expect[0].kind"],
    ["判分点不是对象", "answered", "[0].expect[0]"],
    ["工具名不认识", { kind: "used-tool", tool: "rm" }, "[0].expect[0].tool"],
    ["工具名缺", { kind: "no-tool" }, "[0].expect[0].tool"],
    ["max 是 0", { kind: "within-turns", max: 0 }, "[0].expect[0].max"],
    ["max 是负数", { kind: "within-turns", max: -1 }, "[0].expect[0].max"],
    ["max 是小数", { kind: "within-turns", max: 1.5 }, "[0].expect[0].max"],
    ["max 是字符串", { kind: "within-turns", max: "3" }, "[0].expect[0].max"],
    ["mentions 是空串", { kind: "mentions", text: "" }, "[0].expect[0].text"],
    ["mentions 缺 text", { kind: "mentions" }, "[0].expect[0].text"],
  ])("%s → 点名 %s", (_name, check, at) => {
    expect(ats(parseCases([good({ expect: [check] })]))).toContain(at);
  });

  it("max 恰好是 1 是合法的（边界在 0 那一侧）", () => {
    expect(
      parseCases([good({ expect: [{ kind: "within-turns", max: 1 }] })]).ok,
    ).toBe(true);
  });
});

describe("parseCases · 一次报全部", () => {
  it("三道题各错一处，三条错误一起报", () => {
    const r = parseCases([
      good({ id: "" }),
      good({ id: "b", question: 1 }),
      good({ id: "c", tags: "x" }),
    ]);
    expect(ats(r)).toEqual(["[0].id", "[1].question", "[2].tags"]);
  });

  it("同一道题里的多处错误也一起报", () => {
    const r = parseCases([{ id: "", question: "", expect: [], tags: "x" }]);
    expect(ats(r)).toEqual([
      "[0].id",
      "[0].question",
      "[0].expect",
      "[0].tags",
    ]);
  });

  it("一道题里的多条判分点各自报", () => {
    const r = parseCases([
      good({
        expect: [
          { kind: "answered" },
          { kind: "used-tool", tool: "rm" },
          { kind: "within-turns", max: 0 },
        ],
      }),
    ]);
    expect(ats(r)).toEqual(["[0].expect[1].tool", "[0].expect[2].max"]);
  });
});

describe("parseCases · 每条错误都说得出原因", () => {
  it("why 不许是空串 —— 题库写坏时人要看得懂", () => {
    // NOTE: 不逐条钉死措辞（那会脆），只钉「说得出」。
    //       变异测试之前，13 个 why 字面量换成空串一条都不会红。
    const r = parseCases([
      "不是对象",
      { id: "", question: "", expect: [], tags: "x" },
      good({ id: "tags-mixed", tags: ["a", 1] }),
      good({
        expect: [
          "判分点不是对象",
          { kind: "vibes" },
          { kind: "used-tool", tool: "rm" },
          { kind: "within-turns", max: 0 },
          { kind: "mentions", text: "" },
        ],
      }),
      good({ id: "dup" }),
      good({ id: "dup" }),
    ]);
    expect(r.ok).toBe(false);
    const whys = r.ok ? [] : r.error.map((e) => e.why);
    expect(whys.length).toBeGreaterThanOrEqual(11);
    for (const w of whys) expect(w).not.toBe("");
  });
});

describe("parseCases · id 重复", () => {
  it("两道题同一个 id 就拒（同 ADR 0012 §③ 拒绝同名录音带）", () => {
    const r = parseCases([good({ id: "dup" }), good({ id: "dup" })]);
    expect(ats(r)).toEqual(["dup"]);
  });

  it("三道题两个重复，只报一次多出来的那个", () => {
    const r = parseCases([
      good({ id: "dup" }),
      good({ id: "ok" }),
      good({ id: "dup" }),
    ]);
    expect(ats(r)).toEqual(["dup"]);
  });

  it("已经不合法的题不参与重复检查 —— 同一处错误不报两次", () => {
    // 两道题的 id 都是空串。它们各自已经因为 id 非法被拒了，
    // IMPORTANT: 不该再因为「两个空串一样」多报一条 id 重复。
    expect(ats(parseCases([good({ id: "" }), good({ id: "" })]))).toEqual([
      "[0].id",
      "[1].id",
    ]);
  });

  it("id 不重复时不报", () => {
    expect(parseCases([good({ id: "a" }), good({ id: "b" })]).ok).toBe(true);
  });
});

describe("parseCases · 真题库", () => {
  it("eval/cases.json 收得进来", async () => {
    const { readFileSync } = await import("node:fs");
    const raw: unknown = JSON.parse(readFileSync("eval/cases.json", "utf8"));
    const r = parseCases(raw);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.length).toBeGreaterThan(0);
  });
});
