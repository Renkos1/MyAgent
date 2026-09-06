/**
 * 跑一组题，出一份成绩单。纯的 —— 时间和 IO 都从参数进来。
 *
 * @remarks
 * IMPORTANT: 这一层**永远不抛、永远不判「整体过没过」**。
 * 阈值 k 的输入 p0 现在是未知数（还没接真模型），写任何一个 k 都是瞎选一个 ——
 * 判据和解除条件见 ADR 0013 §④。所以这里只出数字，不出裁决。
 *
 * @see docs/decisions/0013-eval-case-format.md
 */
import type { EvalCase, Transcript } from "./case.ts";
import { describeCheck, judge } from "./case.ts";

/**
 * 被测对象：给一个问题，跑出一份记录。
 *
 * @remarks
 * 阶段 3 只有假模型，阶段 4 换成真的 —— 换的只有这一个函数。
 * 这和 `Deps` 里注入 `LlmPort` 是同一个手法，只是粒度更粗：
 * eval 不关心内部怎么装配的，只关心「问一句，得到一份记录」。
 */
export type Subject = (question: string) => Promise<Transcript>;

/** 一道题的成绩。failed 为空 = 全过。 */
export type CaseResult = {
  readonly id: string;
  readonly passed: boolean;
  /** 挂掉的那几条判分点的人话。ADR 0013 §② 的代价条要求逐条记。 */
  readonly failed: readonly string[];
};

/**
 * 一次跑的成绩单。
 *
 * @remarks
 * 只存汇总 + 失败明细，**不存模型的完整输出**（ADR 0013 §③）。
 * 反悔信号也写在那里：第一次「看数字看不出问题在哪」的时候改成存输出，
 * 那时要一起定脱敏，和 ADR 0012 SAFETY 同一套规矩。
 */
export type EvalReport = {
  /** ISO 时间戳。 */
  readonly at: string;
  /** 被测对象叫什么。阶段 4 起这里放模型名。 */
  readonly subject: string;
  readonly passed: number;
  readonly total: number;
  /** IMPORTANT: 只有失败的题在这里。全过时是空数组。 */
  readonly failures: readonly CaseResult[];
};

/** 判一道题的全部判分点。 */
function judgeCase(c: EvalCase, t: Transcript): CaseResult {
  const failed = c.expect.filter((e) => !judge(e, t)).map(describeCheck);
  return { id: c.id, passed: failed.length === 0, failed };
}

/**
 * 跑一组题。
 *
 * @remarks
 * IMPORTANT: 题目按顺序串行跑，不并发 —— 真模型那边有速率限制，
 * 而且并发会让「第几道题挂的」这件事在日志里错位。
 *
 * 被测对象抛异常时那道题记 0 分，不中断整组：
 * NOTE: 一道题炸掉不该让另外 99 道题的分数丢掉。
 *
 * @param cases - 题目
 * @param subject - 被测对象
 * @param name - 写进成绩单的被测对象名字
 * @param now - 注入的时钟。IMPORTANT: 不注入的话成绩单没法断言
 * @returns 成绩单
 */
export async function runEval(
  cases: readonly EvalCase[],
  subject: Subject,
  name: string,
  now: () => Date,
): Promise<EvalReport> {
  const results: CaseResult[] = [];
  for (const c of cases) {
    let r: CaseResult;
    try {
      r = judgeCase(c, await subject(c.question));
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      r = { id: c.id, passed: false, failed: [`被测对象抛了：${why}`] };
    }
    results.push(r);
  }
  return {
    at: now().toISOString(),
    subject: name,
    passed: results.filter((r) => r.passed).length,
    total: results.length,
    failures: results.filter((r) => !r.passed),
  };
}
