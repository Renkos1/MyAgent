import type { Result } from "./result.ts";
import { err, ok } from "./result.ts";

/**
 * agent 主循环的预算：模型调用次数和工具执行次数各一个上限。
 *
 * ★纯的那一半★：只做加法和比较。不调模型、不执行工具、不看时钟、
 * 不碰 AbortSignal。循环本身在阶段 2 的适配器里。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────
 *
 * 主循环里决定「还要不要再转一圈」的是模型自己，而模型是概率性的 ——
 * 没有任何东西保证它会在有限步内说「我说完了」。
 * ★轮次上限是这个循环里唯一一个不依赖模型配合的终止保证。★
 *
 * ── 契约 ────────────────────────────────────────────────────────
 *
 * ① 数什么？
 *      ★两个独立上限★：模型调用次数、工具执行次数。
 *      理由：一次响应可以并行要求调用多个工具，两个数字差得很远
 *            （5 次响应 × 每次 3 个工具 = 5 vs 15）。
 *            按模型调用数防的是花钱，按工具执行数防的是副作用。
 *      代价：调用方要配两个数，也要处理两种「撞上限」。
 *
 * ② 形态？
 *      ★状态转换★：吃一个 LoopState，吐一个新的 LoopState。
 *      不是谓词 —— 谓词可以被忘记调用，状态转换不能：
 *      你要拿到下一个 state，就必须经过这里，计数是它的副产品。
 *
 * ③ 上限值非法怎么办？
 *      ★构造时校验一次，之后不再校验★（smart constructor）。
 *      合法 = 安全整数且 >= 1。这一条判据同时挡掉：
 *          0 / 负数 / 小数 / Infinity / NaN / 超出安全整数范围
 *      ⚠ 必须用 isSafeInteger 而不是 isInteger：
 *        Number.isInteger(2**53) 是 true，但 2**53 + 1 === 2**53 也是 true。
 *        ★计数器加不上去，循环永远到不了上限★ —— 正是这个模块要防的事。
 *      两个都非法时只报第一个（model-calls 优先）。
 *      代价：修完第一个才会发现第二个也错。
 *
 * ④ 撞上限是 ok 还是 err？
 *      ★err★。撞上限意味着「这个动作不能做」，调用方必须改变行为。
 *      放进错误分支，类型系统会强迫它处理，忽略不了。
 *      代价：调用方每次都要 if (!r.ok)。
 *      错误里带 used / max —— 收尾时要告诉用户「跑了 N 轮，上限 N」。
 *
 * ⑤ 上限带不带出错的值？
 *      ★带★（InvalidLimit.value、InvalidCount.value）。
 *      ⚠ 这和 path.ts 契约⑤的结论相反，但★判据是同一条：值从哪来。★
 *        path：来自模型/用户 → 进日志就是把攻击载荷原样落盘 → 不带。
 *        这里：来自自己的配置和自己的适配器 → 带上才好排错 → 带。
 *
 * ⑥ 一次要跑 N 个工具，但额度只剩 M < N 个？
 *      ★全拒绝，一个都不跑★（原子性）。
 *      理由：领域层只能返回一个状态，做不了「部分执行」；
 *            而部分执行会留下一半的副作用，比浪费额度难收拾。
 *      代价：剩 2 个额度时来了 3 个工具请求，那 2 个额度就浪费了。
 *
 * ⑦ 给后面的阶段留位置？
 *      ★只留"加字段是便宜的"，不提前加参数。★
 *      大小上限（1.3）、终止条件（1.4）进来时，是往 LoopState 和
 *      LoopLimits 各加一个字段 —— 双向门。
 *      现在就把 AbortSignal 塞进签名，是现在付成本、收益在两阶段之后，
 *      而且它可变、绑事件循环，会让这个函数不再是纯函数。
 */

/** 品牌符号。只声明不定义 —— 运行时不存在，只在类型层面挡人。 */
declare const brand: unique symbol;

/** 哪一个上限。两者的处理方式相同，所以是同一个 kind 的参数，不是两个 kind。 */
export type LimitName =
  "model-calls" | "tool-runs" | "input-bytes-per-item" | "input-bytes-total";

/** 构造时上限值非法。来自配置，所以可以带上原值。 */
export type InvalidLimit = {
  readonly kind: "invalid-limit";
  readonly limit: LimitName;
  readonly value: number;
};

/** 一次要跑的工具个数非法。来自适配器读到的响应，同样是自己的东西。 */
export type InvalidCount = {
  readonly kind: "invalid-count";
  readonly value: number;
};

/** 撞上限。used 是已用掉的额度，max 是上限本身。 */
export type LimitReached = {
  readonly kind: "limit-reached";
  readonly limit: LimitName;
  readonly used: number;
  readonly max: number;
};

export type LoopLimits = {
  readonly maxModelCalls: number;
  readonly maxToolRuns: number;
  /** 单个文本的字节上限。★由 input.ts 判★ —— 它是无状态的规则。 */
  readonly maxInputBytesPerItem: number;
  /** 累计输入的字节上限。由本模块的 recordInputBytes 判 —— 它需要状态。 */
  readonly maxInputBytesTotal: number;
};

/**
 * 循环预算的当前状态。
 *
 * ★带品牌，只能由 createLoopState 产出★ —— 拿到一个 LoopState 就等于
 * 它的上限已经校验过了，转换函数不必再查一遍。
 * 这就是「让非法状态无法被表示」在 TS 里的落地形态。
 */
export type LoopState = {
  readonly limits: LoopLimits;
  readonly modelCalls: number;
  readonly toolRuns: number;
  readonly inputBytes: number;
  readonly [brand]: true;
};

/** 合法的次数：安全整数且至少为 1。见契约③。 */
function isValidCount(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 1;
}

/** 校验上限并构造初始状态。这是拿到 LoopState 的唯一入口。 */
export function createLoopState(
  limits: LoopLimits,
): Result<LoopState, InvalidLimit> {
  if (!isValidCount(limits.maxModelCalls)) {
    return err({
      kind: "invalid-limit",
      limit: "model-calls",
      value: limits.maxModelCalls,
    });
  }
  if (!isValidCount(limits.maxToolRuns)) {
    return err({
      kind: "invalid-limit",
      limit: "tool-runs",
      value: limits.maxToolRuns,
    });
  }
  if (!isValidCount(limits.maxInputBytesPerItem)) {
    return err({
      kind: "invalid-limit",
      limit: "input-bytes-per-item",
      value: limits.maxInputBytesPerItem,
    });
  }
  if (!isValidCount(limits.maxInputBytesTotal)) {
    return err({
      kind: "invalid-limit",
      limit: "input-bytes-total",
      value: limits.maxInputBytesTotal,
    });
  }
  return ok({
    limits,
    modelCalls: 0,
    toolRuns: 0,
    inputBytes: 0,
  } as LoopState);
}

/** 记一次模型调用。到上限则拒绝，状态不变。 */
export function recordModelCall(
  state: LoopState,
): Result<LoopState, LimitReached> {
  const { maxModelCalls } = state.limits;
  if (state.modelCalls >= maxModelCalls) {
    return err({
      kind: "limit-reached",
      limit: "model-calls",
      used: state.modelCalls,
      max: maxModelCalls,
    });
  }
  return ok({ ...state, modelCalls: state.modelCalls + 1 });
}

/**
 * 记一批工具执行。count 是这一次响应里要并行跑的工具个数。
 * 额度不够时★一个都不跑★（契约⑥）。
 */
export function recordToolRuns(
  state: LoopState,
  count: number,
): Result<LoopState, LimitReached | InvalidCount> {
  if (!isValidCount(count)) {
    return err({ kind: "invalid-count", value: count });
  }
  const { maxToolRuns } = state.limits;
  if (state.toolRuns + count > maxToolRuns) {
    return err({
      kind: "limit-reached",
      limit: "tool-runs",
      used: state.toolRuns,
      max: maxToolRuns,
    });
  }
  return ok({ ...state, toolRuns: state.toolRuns + count });
}

/**
 * 记一段输入的字节数。★只判总和★ —— 单个文本的上限是无状态规则，
 * 由 input.ts 在测量的时候就地判掉，不必进到状态里。
 *
 * 和 recordToolRuns 一样是原子的：额度不够就一个字节都不记（契约⑥）。
 */
export function recordInputBytes(
  state: LoopState,
  bytes: number,
): Result<LoopState, LimitReached | InvalidCount> {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    return err({ kind: "invalid-count", value: bytes });
  }
  const { maxInputBytesTotal } = state.limits;
  if (state.inputBytes + bytes > maxInputBytesTotal) {
    return err({
      kind: "limit-reached",
      limit: "input-bytes-total",
      used: state.inputBytes,
      max: maxInputBytesTotal,
    });
  }
  return ok({ ...state, inputBytes: state.inputBytes + bytes });
}
