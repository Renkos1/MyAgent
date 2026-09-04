import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { measure, truncateToBytes } from "../../src/domain/size.ts";

/**
 * 属性测试：例子测试验证「我想到的情况」，这里搜索「我没想到的」。
 *
 * ★生成器有多宽，性质就有多强。★
 * fast-check 4 的 fc.string() 默认 unit 是 'grapheme-ascii' ——
 * 一个中文、一个 emoji 都不产。对一个专门处理 emoji 的模块，
 * 用默认生成器等于什么都没测。
 */

/** 自定义 unit：只产我们关心的形状，撞上 bug 的概率比通用生成器高得多。 */
const PIECE = fc.constantFrom(
  "a",
  "\n",
  "你",
  "é", // 组合重音，两个码点一个字素簇
  "é", // 预组合，一个码点
  "👍", // 星平面，两个 UTF-16 单元
  "👨‍👩‍👧", // ZWJ 家庭，8 个 UTF-16 单元、5 个码点、1 个字素簇
  "🇯🇵",
);
const text = fc.string({ unit: PIECE, maxLength: 8 });
const budget = fc.nat({ max: 40 });

const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const graphemesOf = (s: string) => [...seg.segment(s)].map((g) => g.segment);

/** 领域层很小，跑多一点也很快。默认 100 对千分之一的 bug 不够。 */
const RUNS = { numRuns: 500 };

describe("truncateToBytes 的性质", () => {
  // ★这一条是核心★：三条"基本"性质都满足的错误实现，被它一次抓住。
  // 实测：把实现改成按★码点★切（而不是字素簇），良构/不超上限/是前缀全绿，
  // 只有这一条红，反例收缩到 ["👨‍👩‍👧", 4]。
  it("★结果切在字素簇边界上★ —— 永不把一个字符切成两半", () => {
    fc.assert(
      fc.property(text, budget, (t, max) => {
        const kept = truncateToBytes(t, max);
        const all = graphemesOf(t);
        const got = graphemesOf(kept);
        expect(all.slice(0, got.length)).toEqual(got);
      }),
      RUNS,
    );
  });

  it("结果永远是良构 Unicode", () => {
    fc.assert(
      fc.property(text, budget, (t, max) =>
        truncateToBytes(t, max).isWellFormed(),
      ),
      RUNS,
    );
  });

  it("结果的 UTF-8 字节数不超过上限", () => {
    fc.assert(
      fc.property(
        text,
        budget,
        (t, max) => measure(truncateToBytes(t, max), "utf-8") <= max,
      ),
      RUNS,
    );
  });

  it("结果永远是原文的前缀 —— 只删不改", () => {
    fc.assert(
      fc.property(text, budget, (t, max) =>
        t.startsWith(truncateToBytes(t, max)),
      ),
      RUNS,
    );
  });

  it("★幂等★：截过一次再截同一个上限，结果不变", () => {
    fc.assert(
      fc.property(text, budget, (t, max) => {
        const once = truncateToBytes(t, max);
        expect(truncateToBytes(once, max)).toBe(once);
      }),
      RUNS,
    );
  });

  // 上限放宽，保留的内容只能变多不能变少，而且是前缀链。
  // 错误实现（比如退到换行时算错偏移）会在某个 max 上"倒退"。
  it("★单调★：上限越大，结果只增不减，且前一个是后一个的前缀", () => {
    fc.assert(
      fc.property(text, budget, budget, (t, a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const small = truncateToBytes(t, lo);
        const big = truncateToBytes(t, hi);
        expect(big.startsWith(small)).toBe(true);
      }),
      RUNS,
    );
  });
});

describe("measure 的性质", () => {
  // 这一条把 docs/01 第 13 节那张表压成一句话。
  it("★四个单位的大小关系★：字素簇 ≤ 码点 ≤ UTF-16 ≤ UTF-8", () => {
    fc.assert(
      fc.property(text, (t) => {
        const g = measure(t, "grapheme");
        const c = measure(t, "code-point");
        const u = measure(t, "utf-16");
        const b = measure(t, "utf-8");
        expect([g <= c, c <= u, u <= b]).toEqual([true, true, true]);
      }),
      RUNS,
    );
  });

  it("★UTF-8 字节可加★：良构输入拼接，字节数相加", () => {
    fc.assert(
      fc.property(text, text, (a, b) => {
        expect(measure(a + b, "utf-8")).toBe(
          measure(a, "utf-8") + measure(b, "utf-8"),
        );
      }),
      RUNS,
    );
  });

  // ★注意这里是不等号★：a 的最后一个字素簇和 b 的第一个可能合并成一个
  // （"e" + "́" → "é"），所以拼接之后字素簇数可能★变少★。
  it("★字素簇只有不等式★：拼接后字素簇数 ≤ 两者之和", () => {
    fc.assert(
      fc.property(text, text, (a, b) => {
        expect(measure(a + b, "grapheme")).toBeLessThanOrEqual(
          measure(a, "grapheme") + measure(b, "grapheme"),
        );
      }),
      RUNS,
    );
  });
});
