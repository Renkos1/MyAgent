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
  | {
      readonly kind: "tool-requested";
      readonly toolCount: number;
    }
  /** 模型正常说完了，没有工具请求。 */
  | {
      readonly kind: "completed";
    }
  /** 输出长度到顶被截断。IMPORTANT: 内容不完整，不能当答案。 */
  | {
      readonly kind: "truncated";
    }
  /** 供应商拒绝生成。 */
  | {
      readonly kind: "refused";
    }
  /** 既没有内容也没有工具请求。 */
  | {
      readonly kind: "empty";
    };

/**
 * 为什么被迫停下。全部都是失败。
 *
 * @remarks
 * 前两支直接复用 loop.ts 的类型，不抄一份同形状的 ——
 * 抄出来的两份会各自漂移，而它们本来就是同一个概念（见 docs/glossary.md）。
 */
export type AbortReason =
  | InsufficientBudget
  | {
      readonly kind: "truncated";
    }
  | {
      readonly kind: "refused";
    }
  | {
      readonly kind: "empty-response";
    }
  | InvalidCount;

/** 三类出口。IMPORTANT: 成功和失败是两个 kind，混不了。 */
export type Decision =
  | {
      readonly kind: "continue";
      readonly toolRuns: number;
    }
  | {
      readonly kind: "done";
    }
  | {
      readonly kind: "aborted";
      readonly reason: AbortReason;
    };

/**
 * 穷尽性守卫。
 *
 * @remarks
 * 联合里加了新 kind 而 switch 没处理时，tsc 会点名漏掉的那一个
 * （TS2345: ... is not assignable to 'never'）。
 */
/* v8 ignore start -- 按定义不可达：能走到这里说明类型检查已经失败了 */
function assertNever(x: never): never {
  if (stryMutAct_9fa48("435")) {
    {
    }
  } else {
    stryCov_9fa48("435");
    throw new Error(
      stryMutAct_9fa48("437")
        ? ``
        : (stryCov_9fa48("437"), `意料之外的分支: ${JSON.stringify(x)}`),
    );
  }
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
  if (stryMutAct_9fa48("438")) {
    {
    }
  } else {
    stryCov_9fa48("438");
    switch (outcome.kind) {
      // IMPORTANT: 完成信号最优先，即使预算刚好用光 ——
      //            模型答完了，用户就是拿到了答案
      case stryMutAct_9fa48("440") ? "" : (stryCov_9fa48("440"), "completed"):
        if (stryMutAct_9fa48("439")) {
        } else {
          stryCov_9fa48("439");
          return stryMutAct_9fa48("441")
            ? {}
            : (stryCov_9fa48("441"),
              {
                kind: stryMutAct_9fa48("442")
                  ? ""
                  : (stryCov_9fa48("442"), "done"),
              });
        }
      // 内容不可信的三种，一律失败
      case stryMutAct_9fa48("444") ? "" : (stryCov_9fa48("444"), "truncated"):
        if (stryMutAct_9fa48("443")) {
        } else {
          stryCov_9fa48("443");
          return stryMutAct_9fa48("445")
            ? {}
            : (stryCov_9fa48("445"),
              {
                kind: stryMutAct_9fa48("446")
                  ? ""
                  : (stryCov_9fa48("446"), "aborted"),
                reason: stryMutAct_9fa48("447")
                  ? {}
                  : (stryCov_9fa48("447"),
                    {
                      kind: stryMutAct_9fa48("448")
                        ? ""
                        : (stryCov_9fa48("448"), "truncated"),
                    }),
              });
        }
      case stryMutAct_9fa48("450") ? "" : (stryCov_9fa48("450"), "refused"):
        if (stryMutAct_9fa48("449")) {
        } else {
          stryCov_9fa48("449");
          return stryMutAct_9fa48("451")
            ? {}
            : (stryCov_9fa48("451"),
              {
                kind: stryMutAct_9fa48("452")
                  ? ""
                  : (stryCov_9fa48("452"), "aborted"),
                reason: stryMutAct_9fa48("453")
                  ? {}
                  : (stryCov_9fa48("453"),
                    {
                      kind: stryMutAct_9fa48("454")
                        ? ""
                        : (stryCov_9fa48("454"), "refused"),
                    }),
              });
        }
      case stryMutAct_9fa48("456") ? "" : (stryCov_9fa48("456"), "empty"):
        if (stryMutAct_9fa48("455")) {
        } else {
          stryCov_9fa48("455");
          return stryMutAct_9fa48("457")
            ? {}
            : (stryCov_9fa48("457"),
              {
                kind: stryMutAct_9fa48("458")
                  ? ""
                  : (stryCov_9fa48("458"), "aborted"),
                reason: stryMutAct_9fa48("459")
                  ? {}
                  : (stryCov_9fa48("459"),
                    {
                      kind: stryMutAct_9fa48("460")
                        ? ""
                        : (stryCov_9fa48("460"), "empty-response"),
                    }),
              });
        }
      // 只查良构，不查预算 —— 谁扣预算谁检查，见 ADR 0006 §③
      case stryMutAct_9fa48("462")
        ? ""
        : (stryCov_9fa48("462"), "tool-requested"):
        if (stryMutAct_9fa48("461")) {
        } else {
          stryCov_9fa48("461");
          {
            if (stryMutAct_9fa48("463")) {
              {
              }
            } else {
              stryCov_9fa48("463");
              const { toolCount } = outcome;
              // NOTE: 这不是预算检查。说要调工具却给 0 个，是响应自相矛盾。
              //       和 recordToolRuns 共用 isValidCount —— 同一个实现调两次，
              //       不是两份实现（两份迟早漂移）。
              if (
                stryMutAct_9fa48("466")
                  ? false
                  : stryMutAct_9fa48("465")
                    ? true
                    : stryMutAct_9fa48("464")
                      ? isValidCount(toolCount)
                      : (stryCov_9fa48("464", "465", "466"),
                        !isValidCount(toolCount))
              ) {
                if (stryMutAct_9fa48("467")) {
                  {
                  }
                } else {
                  stryCov_9fa48("467");
                  return stryMutAct_9fa48("468")
                    ? {}
                    : (stryCov_9fa48("468"),
                      {
                        kind: stryMutAct_9fa48("469")
                          ? ""
                          : (stryCov_9fa48("469"), "aborted"),
                        reason: stryMutAct_9fa48("470")
                          ? {}
                          : (stryCov_9fa48("470"),
                            {
                              kind: stryMutAct_9fa48("471")
                                ? ""
                                : (stryCov_9fa48("471"), "invalid-count"),
                              value: toolCount,
                            }),
                      });
                }
              }
              return stryMutAct_9fa48("472")
                ? {}
                : (stryCov_9fa48("472"),
                  {
                    kind: stryMutAct_9fa48("473")
                      ? ""
                      : (stryCov_9fa48("473"), "continue"),
                    toolRuns: toolCount,
                  });
            }
          }
        }
      /* v8 ignore next 2 -- 穷尽性守卫，按定义不可达 */
      default:
        if (stryMutAct_9fa48("474")) {
        } else {
          stryCov_9fa48("474");
          return assertNever(outcome);
        }
    }
  }
}
