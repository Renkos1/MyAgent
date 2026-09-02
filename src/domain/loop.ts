/**
 * --契约
 *
 * ① 模型被调用的次数与工具被执行的次数各一个上限，各自允许调整
 * ② 形态是状态转换
 * ③ max=0 / 负数 / 小数 / Infinity均拒绝，类型层面挡住
 * ④ 撞上限时返回kind+轮次+上限值
 * ⑤ 计数从0开始，max=1时允许进行一轮状态转换，以此类推。
 * ⑥ 需要给大小上限和中止条件留位置
 */
import { type Result } from "./result.ts";

export type loopError =
  | { readonly kind: "modelCallMaxError" }
  | { readonly kind: "toolRunsMaxError" };

export type resultState =
  | { readonly kind: "正常返回"; turn: number }
  | { readonly kind: "达到上限"; turn: number; max: number }
  | { readonly kind: "中途中止"; turn: number };

export function loopCheck(modelCallMax: number, toolRunsMax: number);
export function loopState(
  modelCallMax: number,
  toolRunsMax: number,
): Result<resultState, loopError> {
  throw Error("None");
}
