import type { Result } from "./result.ts";
import type { LoopLimits, LoopState } from "./loop.ts";
/**
 *
 * ── 契约 ────────────────────────────────────────────────────────
 *
 * ① UTF-8 字节量size
 * ② 由调用方指定，视情况而定
 * ③ 截断时退到最近的换行
 * ④ 设定单个上限和总和上限
 * ⑤ 空文件合法，同样是信息源
 * ⑥ 塞进LoppState作为第三个计数器
 */
export type UnitType = "utf-16" | "code-point" | "utf-8" | "prapheme";

export type InvalidSize =
  | {
      readonly kind: "single";
      readonly index: number;
      readonly value: number;
      readonly max: number;
    }
  | {
      readonly kind: "aggregate";
      readonly value: number;
      readonly max: number;
    };

export type MeasurementResult = {
  readonly unit: UnitType;
  readonly value: number;
};
export type LimitHandler = "truncate" | "reject";
export function measureInputText(
  text: string,
  unit: UnitType,
): MeasurementResult {
  throw Error("None");
}

export function checkSize(
  size: number[],
  limits: LoopLimits,
): Result<number, InvalidSize> {
  throw Error("None");
}

export function parseInputText(
  state: LoopState,
  text: string,
  mode: LimitHandler,
): Result<LoopState, string> {
  throw Error("None");
}
