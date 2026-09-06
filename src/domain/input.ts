import type { InvalidCount, InsufficientBudget, LoopBudget } from "./loop.ts";
import { recordInputBytes } from "./loop.ts";
import type { Result } from "./result.ts";
import { err, ok } from "./result.ts";
import { measure, truncateToBytes } from "./size.ts";

/**
 * 把若干段文本接纳进这一轮，并扣掉输入预算。
 *
 * @remarks
 * 这一层是**组合，不是新规则**：
 * - `size.ts` 量文本、切文本 —— 不认识 LoopBudget
 * - `loop.ts` 扣预算 —— 不认识「文本」
 * - `input.ts` 是唯一同时 import 两边的地方
 *
 * 依赖方向单向（input → { size, loop }），没有环。
 * NOTE: 一个函数的参数类型就是它对世界的依赖声明 ——
 * 让 size.ts 收 LoopLimits，等于宣布它依赖整个循环模块，那是白欠的债。
 *
 * @see docs/decisions/0009-size-and-truncation.md  ⑥⑦⑧ 三条的候选、判据、代价
 */
/** 超限时的处理方式。见 ADR 0009 §②。 */
export type LimitMode = "reject" | "truncate";

/**
 * 每一段文本的处理结果。
 *
 * @remarks
 * IMPORTANT: truncated 是一个 kind 而不是一个布尔 ——
 * 调用方必须 switch，忘了处理就是漏一个 case，编译器会说话。
 */
export type InputItem =
  | { readonly kind: "accepted"; readonly text: string; readonly bytes: number }
  | {
      readonly kind: "truncated";
      readonly text: string;
      readonly originalBytes: number;
      readonly keptBytes: number;
    };

/**
 * 输入没能被接纳的原因。
 *
 * @remarks
 * 前三个是 input.ts 自己的判断，后两个是「组合的成本」——
 * 一旦调用 loop.ts，loop.ts 能返回的错误就并进了这里。
 * NOTE: 每个 kind 都带 index，但★不带那段文本★ —— 它来自模型/用户。
 */
export type InputError =
  /** 输入本身不是良构 Unicode —— 上游多半已经按下标截断过一次。 */
  | { readonly kind: "ill-formed"; readonly index: number }
  /** reject 模式下，单段超过 perItem 上限。 */
  | {
      readonly kind: "item-too-large";
      readonly index: number;
      readonly bytes: number;
      readonly max: number;
    }
  /** 截断之后什么都不剩 —— 给调用方空串等于骗它（ADR 0009 §⑤）。 */
  | {
      readonly kind: "truncated-to-empty";
      readonly index: number;
      readonly originalBytes: number;
    }
  /**
   * 总和超限，以及 recordInputBytes 自己的入参校验。
   *
   * 这两个是"组合的成本"：input.ts 一旦调用 loop.ts，
   * loop.ts 能返回的错误就并进了这里 —— 即使 invalid-count
   * 从 admitInput 出发结构上不可能触发（total 是若干个 measure 之和，
   * 必然是非负安全整数）。
   *
   * 想消掉它，要么让 recordInputBytes 收一个"已校验的字节数"类型
   * （那会让 loop.ts 反过来依赖 size.ts，制造环），
   * 要么在这里 throw（在返回 Result 的领域层里制造第二种失败风格）。
   * IMPORTANT: 两个都比多一个 case 贵。
   */
  | InsufficientBudget
  | InvalidCount;

/** admitInput 成功时的产物：扣过账的预算，加上每段文本的处理结果。 */
export type Admitted = {
  readonly state: LoopBudget;
  readonly items: readonly InputItem[];
};

/**
 * 校验、测量、按模式截断若干段文本，并把总字节数记进预算。
 *
 * @remarks
 * 纯函数：不改入参，返回新的 {@link LoopBudget}。
 * 顺序是死的 —— ★良构检查在测量之前★（不良构的文本量出来的字节数是错的）。
 * 单段上限 reject 就报错、truncate 就切；总量上限一律报错，切不了。
 *
 * @param state - 当前预算，只读
 * @param texts - 待接纳的文本，按顺序；报错时用 index 指回来
 * @param mode - 单段超限时 reject 还是 truncate
 * @returns 成功是 {@link Admitted}，失败是 {@link InputError}
 * @see docs/decisions/0009-size-and-truncation.md
 */
export function admitInput(
  state: LoopBudget,
  texts: readonly string[],
  mode: LimitMode,
): Result<Admitted, InputError> {
  const { maxInputBytesPerItem } = state.limits;
  const items: InputItem[] = [];

  for (const [index, text] of texts.entries()) {
    // SAFETY: 良构检查必须在测量之前 —— 不良构的文本量出来的字节数是错的
    //         （半个代理对会被算成 U+FFFD 的 3 字节）
    if (!text.isWellFormed()) return err({ kind: "ill-formed", index });

    const bytes = measure(text, "utf-8");

    if (bytes <= maxInputBytesPerItem) {
      items.push({ kind: "accepted", text, bytes });
      continue;
    }

    if (mode === "reject") {
      return err({
        kind: "item-too-large",
        index,
        bytes,
        max: maxInputBytesPerItem,
      });
    }

    const kept = truncateToBytes(text, maxInputBytesPerItem);
    if (kept === "") {
      return err({ kind: "truncated-to-empty", index, originalBytes: bytes });
    }
    items.push({
      kind: "truncated",
      text: kept,
      originalBytes: bytes,
      keptBytes: measure(kept, "utf-8"),
    });
  }

  // 原子性（ADR 0009 §⑧）：所有单段都过了，才一次性扣总额度。
  // 中途任何一段失败都已经 return 了，状态一个字节都没动。
  const total = items.reduce(
    (sum, item) =>
      sum + (item.kind === "accepted" ? item.bytes : item.keptBytes),
    0,
  );
  const next = recordInputBytes(state, total);
  if (!next.ok) return next;

  return ok({ state: next.value, items });
}
