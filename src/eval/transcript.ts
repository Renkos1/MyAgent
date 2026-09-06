/**
 * 把 `run` 的事件流 + 返回值压成判分点看得见的 {@link Transcript}。
 *
 * @remarks
 * 这个文件就是 eval 层的 **seam**：判分点只能看到这里投影出来的东西。
 * 投影丢掉的信息（预算数字、重试次数、工具的具体结果）现在判不了 ——
 * IMPORTANT: 要判它们，先改这里，不要在判分点那边想办法绕。
 *
 * @see docs/decisions/0013-eval-case-format.md
 */
import type { ToolName } from "../app/ports.ts";
import type { RunEvent, RunResult } from "../app/runTurn.ts";
import type { Transcript } from "./case.ts";

/**
 * 投影。
 *
 * @param events - `run` 一路 yield 出来的事件，按顺序
 * @param result - `run` 的返回值
 * @returns 判分点能看见的那一小块
 */
export function toTranscript(
  events: readonly RunEvent[],
  result: RunResult,
): Transcript {
  const toolsUsed: ToolName[] = [];
  let turns = 0;
  for (const e of events) {
    // NOTE: 数 turn-started 而不是数 tool-finished ——
    //       「问了模型几次」和「跑了几个工具」是两个数，within-turns 要的是前者。
    if (e.kind === "turn-started") turns += 1;
    if (e.kind === "tool-started") toolsUsed.push(e.call.name);
  }
  return {
    outcome: result.kind,
    answer: result.kind === "done" ? result.text : "",
    toolsUsed,
    turns,
  };
}
