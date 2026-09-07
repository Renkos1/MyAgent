/**
 * 录制计划 —— 哪些场景能从真 provider 上录下来，各自怎么驱动。
 *
 * @remarks
 * IMPORTANT: 这个文件同时被两边用，所以它是**唯一的真相**：
 *
 * ```text
 * scripts/record.ts              照着它去打真 API，存成带子
 * test/infra/replay.test.ts      照着它读带子，跑契约套件
 * ```
 *
 * 两边必须发**一模一样**的请求，否则回放时指纹对不上。分成两份写迟早会漂。
 *
 * NOTE: 没列进来的场景不是「忘了」，是**造不出来**：
 * 429 / 5xx / 网络中断 / 超时要么要压测要么要拔网线，
 * refusal / 未知 stop_reason 得让模型配合，取消类根本不产生 HTTP 往返。
 * 那些进 `cannotStage`，也就是能力矩阵里的空格。
 */
import type { ScenarioName } from "./scenarios.ts";

/** 一个能录的场景：怎么问、用什么配置、期望录到什么。 */
export type Take = {
  readonly name: ScenarioName;
  /** 问什么。IMPORTANT: 录制和回放必须用同一句，否则指纹对不上。 */
  readonly ask: string;
  /** 这一条用多大的 max_tokens。它进请求体，所以也是指纹的一部分。 */
  readonly maxTokens: number;
  /** 用一个坏 key（录 401）。 */
  readonly badKey?: true;
  /** 为什么这样能造出这个场景 —— 录不到时先读这一行。 */
  readonly how: string;
};

/** system 提示词。所有 take 共用，也是指纹的一部分。 */
export const TAPE_SYSTEM =
  "你在回答关于一个代码仓库的问题。需要看文件时就调用工具。";

/**
 * 能录的场景。
 *
 * IMPORTANT: 这张表不是 `Record<ScenarioName, …>` —— 它**故意不全**。
 * 全表在 `scenarios.ts`，这里只列录得到的那些。
 */
export const TAPE_PLAN: readonly Take[] = [
  {
    name: "completed",
    ask: "1 加 1 等于几？直接回答，不要用工具。",
    maxTokens: 512,
    how: "问一个用不上工具的问题 → end_turn + 有 text 块",
  },
  {
    name: "tool-requested-one",
    ask: "src 目录下都有哪些文件？",
    maxTokens: 512,
    how: "问一个非看文件不可的问题 → tool_use，一个块",
  },
  {
    name: "tool-requested-many",
    ask: "同时看一下 src、test、docs 三个目录里各有什么文件。",
    maxTokens: 512,
    how: "一句话里三个目录 → 并发工具调用，三个块（场景要求正好 3 个）",
  },
  {
    name: "truncated",
    ask: "写一段一百字的散文。",
    maxTokens: 24,
    how: "max_tokens 压到远小于回答长度 → stop_reason = max_tokens",
  },
  {
    name: "unauthorized",
    ask: "随便问一句。",
    maxTokens: 64,
    badKey: true,
    how: "换一个假 key → 401",
  },
];
