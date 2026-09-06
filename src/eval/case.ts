/**
 * 题目和判分点 —— eval 这一层的数据格式，纯的，不碰 IO。
 *
 * @remarks
 * IMPORTANT: 这一层的 oracle 不是「等于」。前两层（用例测试 / 契约测试）
 * 断言的是确定结果，这一层断言的是**一批题目的通过率**，而且通过率本身带噪声。
 * 因此这里没有 expect().toBe()，只有「这道题的这条判分点过没过」。
 *
 * 判分点一律**程序可判**（ADR 0013 §①）：调了哪个工具、几轮内答完、答案里
 * 有没有某个字符串。判「答得好不好」要另一个模型当裁判，那条路的前置条件
 * 写死在 ADR 0013 §① 里，现在不许走。
 *
 * @see docs/decisions/0013-eval-case-format.md
 * @see ts-modern-train/docs/engineering/25-testing-the-uncertain.md
 */
import type { ToolName } from "../app/ports.ts";
import type { RunResult } from "../app/runTurn.ts";

/**
 * 跑完一道题留下的、判分点能看见的全部东西。
 *
 * @remarks
 * IMPORTANT: 这是 eval 层的**观测面**，也是它的判分能力上限 ——
 * 这里没有的字段，判分点就永远判不了。加判分点之前先问「它看得见吗」。
 *
 * 和契约测试同一个教训：seam 选在哪，覆盖到的就是哪一段。
 * 这里选在 `run` 的事件流 + 返回值上，所以适配器内部的行为一律看不见。
 */
export type Transcript = {
  /** `run` 的四个顶层 kind 之一。 */
  readonly outcome: RunResult["kind"];
  /** 最终答案。NOTE: 没答出来时是空串，不是 null —— 判分点不用分两种空。 */
  readonly answer: string;
  /** 实际发起过的工具，按发起顺序，重复的保留。 */
  readonly toolsUsed: readonly ToolName[];
  /** 问了模型几次。 */
  readonly turns: number;
};

/**
 * 一条程序可判的判分点。
 *
 * @remarks
 * 闭集，不是自由文本 —— 同 `ToolOutcome.failed` 的 cause（ADR 0007 §⑨）。
 * 自由文本的判分点没法在编译期挡住拼错，也没法枚举「我们能判什么」。
 *
 * `mentions` 是 ADR 0013 §① 的 b 档（关键词），会漏同义改写；
 * 其余四条是 a 档（结构断言），不会错判。**优先用 a 档。**
 */
export type Check =
  /** 至少发起过一次这个工具。 */
  | { readonly kind: "used-tool"; readonly tool: ToolName }
  /** 一次都没发起过这个工具。 */
  | { readonly kind: "no-tool"; readonly tool: ToolName }
  /** 问模型的次数不超过 max。 */
  | { readonly kind: "within-turns"; readonly max: number }
  /** 走到了 done，且答案非空。 */
  | { readonly kind: "answered" }
  /** 答案里含这个子串。NOTE: b 档，会漏同义改写。 */
  | { readonly kind: "mentions"; readonly text: string };

/**
 * 一道题。
 *
 * @remarks
 * `expect` 是数组不是单条（ADR 0013 §②）：一道题可以同时要求
 * 「调了 list_files」和「三轮内答完」，拆成两道题会把同一个问题问两遍 ——
 * IMPORTANT: eval 是按次收费的。
 */
export type EvalCase = {
  readonly id: string;
  readonly question: string;
  readonly expect: readonly Check[];
  readonly tags: readonly string[];
};

/**
 * 判分点的人话，用来写进失败明细。
 *
 * @param check - 要描述的判分点
 * @returns 一行短句，失败时原样进结果 JSON
 */
export function describeCheck(check: Check): string {
  switch (check.kind) {
    case "used-tool":
      return `要调 ${check.tool}`;
    case "no-tool":
      return `不该调 ${check.tool}`;
    case "within-turns":
      return `不超过 ${String(check.max)} 轮`;
    case "answered":
      return "要答出来";
    case "mentions":
      return `答案里要有「${check.text}」`;
  }
}

/**
 * 判一条。
 *
 * @param check - 判分点
 * @param t - 这次跑的记录
 * @returns 过没过
 */
export function judge(check: Check, t: Transcript): boolean {
  switch (check.kind) {
    case "used-tool":
      return t.toolsUsed.includes(check.tool);
    case "no-tool":
      return !t.toolsUsed.includes(check.tool);
    case "within-turns":
      return t.turns <= check.max;
    // IMPORTANT: 两个条件都要 —— outcome 是 done 但 text 是空串的情况真实存在
    //            （runTurn 里 completed 之外的分支会把 text 置空）。
    case "answered":
      return t.outcome === "done" && t.answer.length > 0;
    case "mentions":
      return t.answer.includes(check.text);
  }
}
