import type { LimitName, LoopState } from "./loop.ts";

/**
 * 一轮结束之后：该继续，还是该停？停的话是成功还是失败？
 *
 * ★纯判定★：读 LoopState 但★不返回新状态★，也不碰模型、不碰 IO。
 *
 * ── 为什么它和 1.2 / 1.3 是两类东西 ──────────────────────────────
 *
 * 轮次上限、大小上限判的都是「预算耗尽」—— 那是我们★强制★停的，是失败。
 * 这里判的是「模型说它做完了」—— 那是模型★主动★停的，是成功。
 * 两者都表现为"循环停了"，但一个用户拿到了答案，一个没拿到。
 * ★如果返回类型让它们长得一样，失败就会被当成功报给用户。★
 *
 * ── 契约 ────────────────────────────────────────────────────────
 *
 * ① TurnOutcome 长什么样？
 *      ★判别联合，把"有没有工具请求"和"为什么停"合并成一维。★
 *      理由：这两维的组合有一半是不可能的 ——
 *            · 输出被截断时，工具请求的 JSON 多半是残缺的，用不了
 *            · 供应商拒绝生成时，不可能同时有工具请求
 *            · "正常说完了"和"还要调工具"互斥
 *      判别联合的价值就是让★不可能的组合写不出来★。
 *      代价：适配器（阶段 2）要负责把供应商的响应压成这五个 kind 之一，
 *            压错了这一层看不出来。
 *      ⚠ 具体供应商的字段叫什么、有哪几个取值，★阶段 4 接真模型时实测★。
 *        领域层只建模"有哪几类"，不建模"叫什么"。
 *
 * ② Decision 长什么样？
 *      ★三个顶层 kind：continue / done / aborted。★
 *      理由：成功和失败是调用方的两条不同代码路径，
 *            让它们成为★两个 kind★，就没法把 aborted 顺手当成功处理。
 *      代价：调用方每次都要 switch 三个分支。
 *
 * ③ ★判定顺序★（同时成立时报哪个）
 *      1. completed          → done，★即使预算刚好用光★
 *      2. truncated/refused/empty → aborted
 *      3. tool-requested     → 先查 toolCount 合法性
 *                              再查★工具额度★（这一轮马上要花的）
 *                              再查★模型额度★（下一轮才要花的）
 *                              都够 → continue
 *      判据：★哪个描述了用户实际拿到的东西。★
 *            模型答完了，用户就是拿到了答案 —— 这时报"达到轮次上限"是误导。
 *            模型还要继续而我们不让，用户什么也没拿到 —— 那才是失败。
 *      「近的先查」：工具是这一轮的事，模型调用是下一轮的事。
 *
 * ④ 「输出被截断」算哪一类？
 *      ★aborted★。半句话不是答案，交给用户等于骗他。
 *      对照 1.3 契约⑤（截断成空 = 非法）：同一类问题、同一个答案，
 *      但理由不同 —— 那里是"骗调用方"，这里是"骗用户"。
 *      代价：那半句话拿不到。★但没丢信息★ ——
 *            outcome 本来就在调用方手里，要展示自己取。
 *
 * ⑤ 空响应（没内容也没工具请求）算什么？
 *      ★aborted★。再调一次是同样的输入，大概率同样的结果 —— 这是★活锁★。
 *      ⚠ 判成 continue 的后果是★静默的★：循环空转到轮次上限才停，
 *        花光全部预算换一个失败。
 *
 * ⑥ 要不要动状态？
 *      ★不动。纯判定，只读不写。★
 *      判据（1.3 用过的）：「已终止」需要跨轮次记住吗 —— 不需要，
 *      循环停了就是停了，没有"下一轮"会来读这个标记。
 *      代价：★这次选了谓词，和 1.2 反过来。★
 *            decide 说 aborted 而调用方继续循环，没有任何东西拦得住。
 *            1.2 选状态转换是因为它是循环★里的一步★，
 *            这里是循环的★出口★ —— 出口拦不住不肯走的人。
 *
 * ⑦ 为什么返回 Decision 而不是 Result？
 *      ★aborted 是一个有效的裁决，不是"decide 失败了"。★
 *      decide 永远能给出答案，所以没有错误分支。
 *      「函数失败」和「函数报告了一个失败」是两回事。
 */

/** 这一轮模型那边发生了什么。适配器负责把供应商响应压成其中之一。 */
export type TurnOutcome =
  /** 模型要求调用 toolCount 个工具（可能并行）。 */
  | { readonly kind: "tool-requested"; readonly toolCount: number }
  /** 模型正常说完了，没有工具请求。 */
  | { readonly kind: "completed" }
  /** 输出长度到顶被截断 —— ★内容不完整，不能当答案★。 */
  | { readonly kind: "truncated" }
  /** 供应商拒绝生成。 */
  | { readonly kind: "refused" }
  /** 既没有内容也没有工具请求。 */
  | { readonly kind: "empty" };

/** 为什么被迫停下。全部都是失败。 */
export type AbortReason =
  | {
      readonly kind: "budget-exhausted";
      readonly limit: LimitName;
      readonly used: number;
      readonly max: number;
    }
  | { readonly kind: "truncated" }
  | { readonly kind: "refused" }
  | { readonly kind: "empty-response" }
  /** 说要调工具，个数却不是一个正整数 —— 适配器出了问题。 */
  | { readonly kind: "invalid-tool-count"; readonly value: number };

/** 三类出口。★成功和失败是两个 kind，混不了。★ */
export type Decision =
  | { readonly kind: "continue"; readonly toolRuns: number }
  | { readonly kind: "done" }
  | { readonly kind: "aborted"; readonly reason: AbortReason };

/**
 * 穷尽性守卫。联合里加了新 kind 而这里没处理时，
 * tsc 会直接点名漏掉的那一个（TS2345: ... is not assignable to 'never'）。
 */
/* v8 ignore start -- 按定义不可达：能走到这里说明类型检查已经失败了 */
function assertNever(x: never): never {
  throw new Error(`意料之外的分支: ${JSON.stringify(x)}`);
}
/* v8 ignore stop */

export function decide(state: LoopState, outcome: TurnOutcome): Decision {
  switch (outcome.kind) {
    // 契约③-1：完成信号最优先，★即使预算刚好用光★
    case "completed":
      return { kind: "done" };

    // 契约③-2：内容不可信的三种，一律失败
    case "truncated":
      return { kind: "aborted", reason: { kind: "truncated" } };
    case "refused":
      return { kind: "aborted", reason: { kind: "refused" } };
    case "empty":
      return { kind: "aborted", reason: { kind: "empty-response" } };

    // 契约③-3：要调工具时才查预算
    case "tool-requested": {
      const { toolCount } = outcome;
      if (!Number.isSafeInteger(toolCount) || toolCount < 1) {
        return {
          kind: "aborted",
          reason: { kind: "invalid-tool-count", value: toolCount },
        };
      }

      // 先查工具额度：这一轮马上要花的。原子性同 recordToolRuns —— 不够就一个不跑
      const { maxToolRuns, maxModelCalls } = state.limits;
      if (state.toolRuns + toolCount > maxToolRuns) {
        return {
          kind: "aborted",
          reason: {
            kind: "budget-exhausted",
            limit: "tool-runs",
            used: state.toolRuns,
            max: maxToolRuns,
          },
        };
      }

      // 再查模型额度：跑完工具还要再问一次模型，问不起就★别跑那些工具★
      if (state.modelCalls >= maxModelCalls) {
        return {
          kind: "aborted",
          reason: {
            kind: "budget-exhausted",
            limit: "model-calls",
            used: state.modelCalls,
            max: maxModelCalls,
          },
        };
      }

      return { kind: "continue", toolRuns: toolCount };
    }

    /* v8 ignore next 2 -- 穷尽性守卫，按定义不可达 */
    default:
      return assertNever(outcome);
  }
}
