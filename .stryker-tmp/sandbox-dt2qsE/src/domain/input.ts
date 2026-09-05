// @ts-nocheck
function stryNS_9fa48() {
  var g =
    (typeof globalThis === "object" &&
      globalThis &&
      globalThis.Math === Math &&
      globalThis) ||
    new Function("return this")();
  var ns = g.__stryker__ || (g.__stryker__ = {});
  if (
    ns.activeMutant === undefined &&
    g.process &&
    g.process.env &&
    g.process.env.__STRYKER_ACTIVE_MUTANT__
  ) {
    ns.activeMutant = g.process.env.__STRYKER_ACTIVE_MUTANT__;
  }
  function retrieveNS() {
    return ns;
  }
  stryNS_9fa48 = retrieveNS;
  return retrieveNS();
}
stryNS_9fa48();
function stryCov_9fa48() {
  var ns = stryNS_9fa48();
  var cov =
    ns.mutantCoverage ||
    (ns.mutantCoverage = {
      static: {},
      perTest: {},
    });
  function cover() {
    var c = cov.static;
    if (ns.currentTestId) {
      c = cov.perTest[ns.currentTestId] = cov.perTest[ns.currentTestId] || {};
    }
    var a = arguments;
    for (var i = 0; i < a.length; i++) {
      c[a[i]] = (c[a[i]] || 0) + 1;
    }
  }
  stryCov_9fa48 = cover;
  cover.apply(null, arguments);
}
function stryMutAct_9fa48(id) {
  var ns = stryNS_9fa48();
  function isActive(id) {
    if (ns.activeMutant === id) {
      if (ns.hitCount !== void 0 && ++ns.hitCount > ns.hitLimit) {
        throw new Error(
          "Stryker: Hit count limit reached (" + ns.hitCount + ")",
        );
      }
      return true;
    }
    return false;
  }
  stryMutAct_9fa48 = isActive;
  return isActive(id);
}
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
  | {
      readonly kind: "accepted";
      readonly text: string;
      readonly bytes: number;
    }
  | {
      readonly kind: "truncated";
      readonly text: string;
      readonly originalBytes: number;
      readonly keptBytes: number;
    };
export type InputError =
  /** 输入本身不是良构 Unicode —— 上游多半已经按下标截断过一次。 */
  | {
      readonly kind: "ill-formed";
      readonly index: number;
    }
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
export type Admitted = {
  readonly state: LoopBudget;
  readonly items: readonly InputItem[];
};
export function admitInput(
  state: LoopBudget,
  texts: readonly string[],
  mode: LimitMode,
): Result<Admitted, InputError> {
  if (stryMutAct_9fa48("218")) {
    {
    }
  } else {
    stryCov_9fa48("218");
    const { maxInputBytesPerItem } = state.limits;
    const items: InputItem[] = stryMutAct_9fa48("219")
      ? ["Stryker was here"]
      : (stryCov_9fa48("219"), []);
    for (const [index, text] of texts.entries()) {
      if (stryMutAct_9fa48("220")) {
        {
        }
      } else {
        stryCov_9fa48("220");
        // SAFETY: 良构检查必须在测量之前 —— 不良构的文本量出来的字节数是错的
        //         （半个代理对会被算成 U+FFFD 的 3 字节）
        if (
          stryMutAct_9fa48("223")
            ? false
            : stryMutAct_9fa48("222")
              ? true
              : stryMutAct_9fa48("221")
                ? text.isWellFormed()
                : (stryCov_9fa48("221", "222", "223"), !text.isWellFormed())
        )
          return err(
            stryMutAct_9fa48("224")
              ? {}
              : (stryCov_9fa48("224"),
                {
                  kind: stryMutAct_9fa48("225")
                    ? ""
                    : (stryCov_9fa48("225"), "ill-formed"),
                  index,
                }),
          );
        const bytes = measure(
          text,
          stryMutAct_9fa48("226") ? "" : (stryCov_9fa48("226"), "utf-8"),
        );
        if (
          stryMutAct_9fa48("230")
            ? bytes > maxInputBytesPerItem
            : stryMutAct_9fa48("229")
              ? bytes < maxInputBytesPerItem
              : stryMutAct_9fa48("228")
                ? false
                : stryMutAct_9fa48("227")
                  ? true
                  : (stryCov_9fa48("227", "228", "229", "230"),
                    bytes <= maxInputBytesPerItem)
        ) {
          if (stryMutAct_9fa48("231")) {
            {
            }
          } else {
            stryCov_9fa48("231");
            items.push(
              stryMutAct_9fa48("233")
                ? {}
                : (stryCov_9fa48("233"),
                  {
                    kind: stryMutAct_9fa48("234")
                      ? ""
                      : (stryCov_9fa48("234"), "accepted"),
                    text,
                    bytes,
                  }),
            );
            continue;
          }
        }
        if (
          stryMutAct_9fa48("237")
            ? mode !== "reject"
            : stryMutAct_9fa48("236")
              ? false
              : stryMutAct_9fa48("235")
                ? true
                : (stryCov_9fa48("235", "236", "237"),
                  mode ===
                    (stryMutAct_9fa48("238")
                      ? ""
                      : (stryCov_9fa48("238"), "reject")))
        ) {
          if (stryMutAct_9fa48("239")) {
            {
            }
          } else {
            stryCov_9fa48("239");
            return err(
              stryMutAct_9fa48("240")
                ? {}
                : (stryCov_9fa48("240"),
                  {
                    kind: stryMutAct_9fa48("241")
                      ? ""
                      : (stryCov_9fa48("241"), "item-too-large"),
                    index,
                    bytes,
                    max: maxInputBytesPerItem,
                  }),
            );
          }
        }
        const kept = truncateToBytes(text, maxInputBytesPerItem);
        if (
          stryMutAct_9fa48("244")
            ? kept !== ""
            : stryMutAct_9fa48("243")
              ? false
              : stryMutAct_9fa48("242")
                ? true
                : (stryCov_9fa48("242", "243", "244"),
                  kept ===
                    (stryMutAct_9fa48("245")
                      ? "Stryker was here!"
                      : (stryCov_9fa48("245"), "")))
        ) {
          if (stryMutAct_9fa48("246")) {
            {
            }
          } else {
            stryCov_9fa48("246");
            return err(
              stryMutAct_9fa48("247")
                ? {}
                : (stryCov_9fa48("247"),
                  {
                    kind: stryMutAct_9fa48("248")
                      ? ""
                      : (stryCov_9fa48("248"), "truncated-to-empty"),
                    index,
                    originalBytes: bytes,
                  }),
            );
          }
        }
        items.push(
          stryMutAct_9fa48("250")
            ? {}
            : (stryCov_9fa48("250"),
              {
                kind: stryMutAct_9fa48("251")
                  ? ""
                  : (stryCov_9fa48("251"), "truncated"),
                text: kept,
                originalBytes: bytes,
                keptBytes: measure(
                  kept,
                  stryMutAct_9fa48("252")
                    ? ""
                    : (stryCov_9fa48("252"), "utf-8"),
                ),
              }),
        );
      }
    }

    // 原子性（ADR 0009 §⑧）：所有单段都过了，才一次性扣总额度。
    // 中途任何一段失败都已经 return 了，状态一个字节都没动。
    const total = items.reduce(
      stryMutAct_9fa48("253")
        ? () => undefined
        : (stryCov_9fa48("253"),
          (sum, item) =>
            stryMutAct_9fa48("254")
              ? sum - (item.kind === "accepted" ? item.bytes : item.keptBytes)
              : (stryCov_9fa48("254"),
                sum +
                  ((
                    stryMutAct_9fa48("257")
                      ? item.kind !== "accepted"
                      : stryMutAct_9fa48("256")
                        ? false
                        : stryMutAct_9fa48("255")
                          ? true
                          : (stryCov_9fa48("255", "256", "257"),
                            item.kind ===
                              (stryMutAct_9fa48("258")
                                ? ""
                                : (stryCov_9fa48("258"), "accepted")))
                  )
                    ? item.bytes
                    : item.keptBytes))),
      0,
    );
    const next = recordInputBytes(state, total);
    if (
      stryMutAct_9fa48("261")
        ? false
        : stryMutAct_9fa48("260")
          ? true
          : stryMutAct_9fa48("259")
            ? next.ok
            : (stryCov_9fa48("259", "260", "261"), !next.ok)
    )
      return next;
    return ok(
      stryMutAct_9fa48("262")
        ? {}
        : (stryCov_9fa48("262"),
          {
            state: next.value,
            items,
          }),
    );
  }
}
