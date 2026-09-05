/**
 * 用例层的配置：把一堆裸数字变成一个构造不出非法值的类型。
 *
 * @remarks
 * 领域层从阶段 1 起就是「校验」派 —— `createLoopBudget` / `isValidCount` /
 * `admitInput` 都是「坏输入 → 明确失败」。而 `RunConfig` 里
 * `maxConcurrentTools` / `maxRetries` / `retryBaseMs` 三个字段一直裸奔。
 *
 * 这里用 smart constructor + branded type 补上：`run` 只收 {@link ValidRunConfig}，
 * 而它只能由 {@link createRunConfig} 产出。非法配置在类型层就传不进去。
 *
 * @see docs/decisions/0003-validated-run-config.md  候选、判据、代价、反悔信号
 */
import type { InvalidLimit, LoopBudget, LoopLimits } from "../domain/loop.ts";
import { createLoopBudget } from "../domain/loop.ts";
import type { LimitMode } from "../domain/input.ts";
import type { Result } from "../domain/result.ts";
import { err, ok } from "../domain/result.ts";

/** 调用方写出来的原始配置。允许非法 —— 校验是 {@link createRunConfig} 的事。 */
export type RunConfig = {
  readonly limits: LoopLimits;
  /** 一批工具最多几个同时跑。必须 >= 1。 */
  readonly maxConcurrentTools: number;
  /** 一次 send 失败后最多重试几次。0 = 不重试。 */
  readonly maxRetries: number;
  /** 指数退避的基数（毫秒）。供应商给了 retryAfterMs 时以它为准。 */
  readonly retryBaseMs: number;
  /** 用户输入超长时怎么办。 */
  readonly userInputMode: LimitMode;
  /** 工具结果超长时怎么办。IMPORTANT: 和 userInputMode 是两件事，别写混。 */
  readonly toolResultMode: LimitMode;
};

declare const validated: unique symbol;

/**
 * 校验过的配置。
 *
 * @remarks
 * 除了品牌，它还带着 `initialBudget` —— 这不是为了省一次调用，
 * 而是为了让 `run` 里不再存在「上限非法」这条分支。
 * `LoopBudget` 是不可变的（每个 `record*` 都返回新对象），所以一份零值预算
 * 可以被任意多次 `run` 共用。
 *
 * NOTE: 没有这个字段的话，`run` 里 `createLoopBudget` 的失败分支会变成死代码 ——
 * 走不到、测不出、覆盖率永远缺一块。那正是 ❸B 想消灭的东西。
 */
export type ValidRunConfig = RunConfig & {
  readonly initialBudget: LoopBudget;
  readonly [validated]: true;
};

/** 配置为什么不合法。NOTE: kind 描述的是哪个字段错了，不是错成什么样。 */
export type ConfigError =
  | InvalidLimit
  | { readonly kind: "invalid-concurrency"; readonly value: number }
  | { readonly kind: "invalid-retries"; readonly value: number }
  | { readonly kind: "invalid-backoff"; readonly value: number };

/** 非负安全整数。NaN / Infinity / 小数 / 负数全部挡在外面。 */
const isCount = (n: number): boolean => Number.isSafeInteger(n) && n >= 0;

/**
 * 校验一份配置，成功时给出带品牌的版本。
 *
 * @param raw - 调用方写的配置，允许非法
 * @returns 校验过的配置，或者第一个不合法的字段
 *
 * @example
 * ```ts
 * const cfg = createRunConfig({ limits, maxConcurrentTools: 4, ... });
 * if (!cfg.ok) throw new Error(`配置错了：${cfg.error.kind}`);
 * const gen = run(deps, cfg.value, sys, question);
 * ```
 *
 * @see docs/decisions/0003-validated-run-config.md
 */
export function createRunConfig(
  raw: RunConfig,
): Result<ValidRunConfig, ConfigError> {
  // IMPORTANT: 0 不合法。「一个都不并发」不是一种配置，是一个错误 ——
  //            TRAP: 之前 width = Math.min(0, n) = 0 时一个 worker 都不启动，
  //            结果数组留下空洞，一路流进 domain/input.ts 才崩，
  //            报错地点和原因隔了三层。2026-09 实测。
  if (!isCount(raw.maxConcurrentTools) || raw.maxConcurrentTools < 1) {
    return err({ kind: "invalid-concurrency", value: raw.maxConcurrentTools });
  }
  // NOTE: 0 合法 —— 「不重试」是一个有意义的选择（测试里就这么用）。
  if (!isCount(raw.maxRetries)) {
    return err({ kind: "invalid-retries", value: raw.maxRetries });
  }
  // NOTE: 0 也合法 —— 测试里把等待压成 0，配合注入的 sleep 让时间免费。
  if (!isCount(raw.retryBaseMs)) {
    return err({ kind: "invalid-backoff", value: raw.retryBaseMs });
  }

  const budget = createLoopBudget(raw.limits);
  if (!budget.ok) return err(budget.error);

  return ok({ ...raw, initialBudget: budget.value } as ValidRunConfig);
}
