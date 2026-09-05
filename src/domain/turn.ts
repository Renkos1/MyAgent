import type { InsufficientBudget, InvalidCount } from "./loop.ts";
import { isValidCount } from "./loop.ts";

/**
 * 一轮结束之后的判定：该继续，该收工，还是该中止。
 *
 * @remarks
 * 关键区分是两种「停」：预算耗尽是我们强制停的（失败，用户没拿到答案），
 * 模型说做完了是它主动停的（成功，用户拿到了答案）。
 * IMPORTANT: 两者都表现为「循环停了」——
 * 如果返回类型让它们长得一样，失败就会被当成功报给用户。
 *
 * 纯谓词：只读 outcome，不碰状态、不碰模型、不碰 IO。
 *
 * @see docs/decisions/0006-turn-decision-shape.md
 *      七个决定的候选、判据、代价、反悔信号
 */

/** 这一轮模型那边发生了什么。适配器负责把供应商响应压成其中之一。 */
export type TurnOutcome =
  /** 模型要求调用 toolCount 个工具（可能并行）。 */
  | { readonly kind: "tool-requested"; readonly toolCount: number }
  /** 模型正常说完了，没有工具请求。 */
  | { readonly kind: "completed" }
  /** 输出长度到顶被截断。IMPORTANT: 内容不完整，不能当答案。 */
  | { readonly kind: "truncated" }
  /** 供应商拒绝生成。 */
  | { readonly kind: "refused" }
  /** 既没有内容也没有工具请求。 */
  | { readonly kind: "empty" };

/**
 * 为什么被迫停下。全部都是失败。
 *
 * @remarks
 * 前两支直接复用 loop.ts 的类型，不抄一份同形状的 ——
 * 抄出来的两份会各自漂移，而它们本来就是同一个概念（见 docs/glossary.md）。
 */
export type AbortReason =
  | InsufficientBudget
  | { readonly kind: "truncated" }
  | { readonly kind: "refused" }
  | { readonly kind: "empty-response" }
  | InvalidCount;

/** 三类出口。IMPORTANT: 成功和失败是两个 kind，混不了。 */
export type Decision =
  | { readonly kind: "continue"; readonly toolRuns: number }
  | { readonly kind: "done" }
  | { readonly kind: "aborted"; readonly reason: AbortReason };

/**
 * 穷尽性守卫。
 *
 * @remarks
 * 联合里加了新 kind 而 switch 没处理时，tsc 会点名漏掉的那一个
 * （TS2345: ... is not assignable to 'never'）。
 */
/* v8 ignore start -- 按定义不可达：能走到这里说明类型检查已经失败了 */
function assertNever(x: never): never {
  throw new Error(`意料之外的分支: ${JSON.stringify(x)}`);
}
/* v8 ignore stop */

/**
 * 判定这一轮之后该怎么走。
 *
 * @param outcome - 适配器压缩后的模型响应
 * @returns 三类出口之一。NOTE: aborted 是一个有效的裁决，不是「decide 失败了」，
 *          所以返回 Decision 而不是 Result
 * @see docs/decisions/0006-turn-decision-shape.md
 */
export function decide(outcome: TurnOutcome): Decision {
  switch (outcome.kind) {
    // IMPORTANT: 完成信号最优先，即使预算刚好用光 ——
    //            模型答完了，用户就是拿到了答案
    case "completed":
      return { kind: "done" };

    // 内容不可信的三种，一律失败
    case "truncated":
      return { kind: "aborted", reason: { kind: "truncated" } };
    case "refused":
      return { kind: "aborted", reason: { kind: "refused" } };
    case "empty":
      return { kind: "aborted", reason: { kind: "empty-response" } };

    // 只查良构，不查预算 —— 谁扣预算谁检查，见 ADR 0006 §③
    case "tool-requested": {
      const { toolCount } = outcome;
      // NOTE: 这不是预算检查。说要调工具却给 0 个，是响应自相矛盾。
      //       和 recordToolRuns 共用 isValidCount —— 同一个实现调两次，
      //       不是两份实现（两份迟早漂移）。
      if (!isValidCount(toolCount)) {
        return {
          kind: "aborted",
          reason: { kind: "invalid-count", value: toolCount },
        };
      }
      return { kind: "continue", toolRuns: toolCount };
    }

    /* v8 ignore next 2 -- 穷尽性守卫，按定义不可达 */
    default:
      return assertNever(outcome);
  }
}
