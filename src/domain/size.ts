import type { Result } from "./result.ts";
import type { LoopLimits, LoopState } from "./loop.ts";
/**
 *
 * ── 契约 ────────────────────────────────────────────────────────
 *
 * ① UTF-8 字节量size
 * ② 由调用方指定，视情况而定
 * ③ 截断时退到最近的换行, 退无可退时，推到最近的字素簇边界
 * ④ 设定单个上限和总和上限
 * ⑤ 空文件合法，但截断成空违法
 * ⑥ 塞进LoppState作为第三个计数器
 */
declare const unitBrand: unique symbol;
export type UnitType = "utf-16" | "code-point" | "utf-8" | "grapheme";

export type Utf8Bytes = number & { readonly [unitBrand]: "utf-8" };
export type CodePoints = number & { readonly [unitBrand]: "code-point" };
export type Utf16Bytes = number & { readonly [unitBrand]: "utf-16" };
export type Grapheme = number & { readonly [unitBrand]: "grapheme" };
export type TextMeasureUnit = Utf8Bytes | CodePoints | Utf16Bytes | Grapheme;
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

export type RecordResult =
  | { kind: "accepted"; state: LoopState; text: string }
  | {
      kind: "truncated";
      state: LoopState;
      text: string;
      originalBytes: number;
      keptBytes: number;
    };

export type SizeError =
  | { kind: "reject"; error: InvalidSize }
  | { kind: "ill-formed"; text: string }
  | { kind: "truncate-empty"; text: string };
export type LimitHandler = "truncate" | "reject";
export function measureInputText(
  text: string,
  unit: UnitType,
): TextMeasureUnit {
  throw Error("None");
}

export function checkSize<T extends TextMeasureUnit>(
  size: T[],
  limits: LoopLimits,
): Result<T, InvalidSize> {
  throw Error("None");
}

export function recordInput(
  state: LoopState,
  text: string[],
  mode: LimitHandler,
): Result<RecordResult, SizeError> {
  throw Error("None");
}
