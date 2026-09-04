import path from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { resolveInsideRoot } from "../../src/domain/path.ts";

const ROOT = "/repo";
const RUNS = { numRuns: 1000 };

/** NUL 字节。★写成转义，别在源码里放裸字节★（shell 和编辑器都会出问题）。 */
const NUL = "\u0000";

/**
 * 路径片段生成器。★故意塞进前缀陷阱的兄弟目录名★ ——
 * "repo-evil" / "repoX" / "repo.bak" 解析后都以字符串 "/repo" 开头但在 root 外。
 * 通用的 fc.string() 几乎不可能随机拼出这些形状，所以自定义生成器
 * 在这里不是优化，是★能不能测到★的问题。
 */
const SEGMENT = fc.constantFrom(
  "..",
  ".",
  "",
  "a",
  "docs",
  "repo",
  "repo-evil",
  "repoX",
  "repo.bak",
  "..foo",
  "...",
  "\\",
  " ",
);

const candidate = fc.oneof(
  fc.array(SEGMENT, { maxLength: 8 }).map((a) => a.join("/")),
  // 绝对路径形态（契约⑥一律拒绝）
  fc.array(SEGMENT, { maxLength: 6 }).map((a) => `/${a.join("/")}`),
  // 反斜杠当分隔符（契约④）
  fc.array(SEGMENT, { maxLength: 6 }).map((a) => a.join("\\")),
  // 带尾斜杠（契约③保留）
  fc.array(SEGMENT, { maxLength: 6 }).map((a) => `${a.join("/")}/`),
  // 含 NUL 字节
  fc.array(SEGMENT, { maxLength: 4 }).map((a) => `${a.join("/")}${NUL}x`),
);

describe("resolveInsideRoot 的性质", () => {
  // ★★这是整个模块存在的理由：CWE-22 路径穿越★★
  //
  // 注意验证用的是 startsWith(ROOT + "/") —— ★同一个 startsWith★，
  // 在「未归一化的输入」上是漏洞，在「已归一化的输出」上是正确的检查。
  // 区别有两点：resolve 已经吃掉了所有 ".."，而且这里带上了分隔符。
  // 所以这条性质不是把实现抄一遍，它是一个独立的判据。
  it("★成功的结果永远在 root 内★ —— 没有任何输入能逃出去", () => {
    fc.assert(
      fc.property(candidate, (c) => {
        const r = resolveInsideRoot(ROOT, c);
        if (!r.ok) return true;
        return r.value === ROOT || r.value.startsWith(`${ROOT}/`);
      }),
      RUNS,
    );
  });

  it("成功的结果永远是绝对路径", () => {
    fc.assert(
      fc.property(candidate, (c) => {
        const r = resolveInsideRoot(ROOT, c);
        return !r.ok || r.value.startsWith("/");
      }),
      RUNS,
    );
  });

  it("★成功的结果里永远没有 .. 段★ —— resolve 已经归一化掉了", () => {
    fc.assert(
      fc.property(candidate, (c) => {
        const r = resolveInsideRoot(ROOT, c);
        if (!r.ok) return true;
        return !r.value.split("/").includes("..");
      }),
      RUNS,
    );
  });

  it("★全函数★：任何字符串都有归宿，不抛异常", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (c) => {
        const r = resolveInsideRoot(ROOT, c);
        return typeof r.ok === "boolean";
      }),
      RUNS,
    );
  });

  it("★不读 process.cwd()★：换掉 cwd 结果不变", () => {
    const cwd = process.cwd();
    try {
      fc.assert(
        fc.property(candidate, (c) => {
          process.chdir("/");
          const a = resolveInsideRoot(ROOT, c);
          process.chdir("/tmp");
          const b = resolveInsideRoot(ROOT, c);
          expect(a).toEqual(b);
        }),
        { numRuns: 200 },
      );
    } finally {
      process.chdir(cwd);
    }
  });
});

// ══════════════════════════════════════════════════════════════
// ★三条"不成立"的性质★ —— 都是契约的直接后果，不是 bug。
// 写下「这条不成立、因为契约第几条」，和写下成立的性质一样有价值：
// 它把「我们知道这里不闭合」和「我们没想到」区分开。
describe("★不幂等 / 往返不闭合★ —— 契约③⑥的代价", () => {
  it("★成功的结果再喂回去，必然被拒为 absolute★（契约⑥）", () => {
    fc.assert(
      fc.property(candidate, (c) => {
        const first = resolveInsideRoot(ROOT, c);
        // ★fc.pre 是断言函数★：它同时做"跳过这个用例"和"收窄类型"两件事，
        // 所以下面不需要再写 if (!first.ok) return —— 写了 lint 会报恒假。
        fc.pre(first.ok);
        // 结果是绝对路径，而契约⑥「绝对路径一律拒绝，即使指向 root 内部」
        expect(resolveInsideRoot(ROOT, first.value)).toEqual({
          ok: false,
          error: { kind: "absolute" },
        });
      }),
      RUNS,
    );
  });

  it("★往返在 root 自身处断开★：relative 给出空串，而空串被拒（契约①vs⑤）", () => {
    // 这个边界随机搜索撞不到（要恰好抵消成 root），直接钉死
    expect(resolveInsideRoot(ROOT, ".")).toEqual({ ok: true, value: ROOT });

    const back = path.posix.relative(ROOT, ROOT);
    expect(back).toBe("");
    expect(resolveInsideRoot(ROOT, back)).toEqual({
      ok: false,
      error: { kind: "empty" },
    });
  });

  it("★尾斜杠让往返不精确★：relative 会吃掉它（契约③的代价）", () => {
    expect(resolveInsideRoot(ROOT, "docs/")).toEqual({
      ok: true,
      value: "/repo/docs/",
    });

    const back = path.posix.relative(ROOT, "/repo/docs/");
    expect(back).toBe("docs"); // ← 尾斜杠没了
    expect(resolveInsideRoot(ROOT, back)).toEqual({
      ok: true,
      value: "/repo/docs", // ← 和原结果差一个斜杠
    });
  });
});
