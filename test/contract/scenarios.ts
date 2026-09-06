/**
 * 契约场景 —— 「外面的世界有几种形状」的完整枚举。
 *
 * IMPORTANT: 这个联合不是 LlmResponse / LlmError 的复述，是对**外部世界**的建模。
 * 两边不是一一对应，而不对应的地方正是端口现在压平掉的信息：
 *
 *   5 种「问不到模型」的外部原因  →  unavailable / rejected 两个 kind
 *   2 种取消（发出去之前 / 发出去之后）→  同一个 aborted
 *
 * 第二条就是 MAP 图 6 的第三态「不知道」：mid-flight 取消时请求已经出去了，
 * 供应商那边可能已经生成、已经计费，而我们的类型说不出这件事。
 * TODO(阶段 7 之前): 见根 README 待办「给 TurnOutcome 补『不知道』那一格」。
 *
 * 每个实现都要能被驱动到这些场景：
 *   FakeLlm       摆脚本
 *   ReplayLlm     挑一盘录音带
 *   AnthropicLlm  只有一部分能可靠触发 —— 摆不出的那些就是能力矩阵里的空格
 */
import type { LlmError, LlmResponse } from "../../src/app/ports.ts";

/** 场景的名字。IMPORTANT: 加一条就会让下面的 SCENARIOS 缺一格，tsc 当场报。 */
export type ScenarioName =
  | "completed"
  | "tool-requested-one"
  | "tool-requested-many"
  | "truncated"
  | "refused"
  | "empty"
  | "rate-limited-with-hint"
  | "rate-limited-no-hint"
  | "server-error"
  | "network-interrupted"
  | "timeout"
  | "unauthorized"
  | "bad-request"
  | "malformed"
  | "aborted-before-send"
  | "aborted-mid-flight";

/**
 * 这个场景在端口上必须长成什么样。
 *
 * NOTE: 没有可选字段 —— exactOptionalPropertyTypes 下可选字段的比较很容易
 * 变成「两边都没有就算过」，那是零鉴别力。用 "n/a" 占位，比较的永远是全字段。
 */
export type Expected =
  | {
      readonly ok: true;
      readonly kind: LlmResponse["kind"];
      /** tool-requested 时要求的工具个数；其余场景固定 0。 */
      readonly toolCalls: number;
    }
  | {
      readonly ok: false;
      readonly kind: LlmError["kind"];
      /** 只有 unavailable 有意义："number" = 供应商给了建议，"null" = 没给。 */
      readonly retryHint: "number" | "null" | "n/a";
    };

/** 一个场景：名字 + 外面发生了什么 + 端口上必须映射成什么。 */
export type Scenario = {
  readonly name: ScenarioName;
  /** 外面发生了什么。真适配器要能造出这件事，造不出就进能力矩阵的空格。 */
  readonly outside: string;
  readonly expected: Expected;
};

const answered = (kind: LlmResponse["kind"], toolCalls: number): Expected => ({
  ok: true,
  kind,
  toolCalls,
});

const failed = (
  kind: LlmError["kind"],
  retryHint: "number" | "null" | "n/a",
): Expected => ({ ok: false, kind, retryHint });

/**
 * 16 个场景的全表。
 *
 * IMPORTANT: 类型是 Record<ScenarioName, …>，少一格 tsc 就红 ——
 * 「场景集长出新的一格」不能靠记性，和 ports.ts 的 KindsMatch 是同一个手法。
 */
export const SCENARIOS: Readonly<Record<ScenarioName, Scenario>> = {
  // ── 模型正常说完了 ──────────────────────────────────────────
  completed: {
    name: "completed",
    outside: "模型正常生成完，stop_reason = end_turn",
    expected: answered("completed", 0),
  },
  "tool-requested-one": {
    name: "tool-requested-one",
    outside: "模型要求调 1 个工具，stop_reason = tool_use",
    expected: answered("tool-requested", 1),
  },
  "tool-requested-many": {
    name: "tool-requested-many",
    outside: "模型一次要求调 3 个工具（并行工具调用）",
    expected: answered("tool-requested", 3),
  },

  // ── 模型说了坏消息：问到了，但拿到的不是答案 ────────────────
  truncated: {
    name: "truncated",
    outside: "输出长度到顶，stop_reason = max_tokens",
    expected: answered("truncated", 0),
  },
  refused: {
    name: "refused",
    outside: "供应商拒绝生成，stop_reason = refusal",
    expected: answered("refused", 0),
  },
  empty: {
    name: "empty",
    outside: "content 是空数组：既没有文本也没有工具请求",
    expected: answered("empty", 0),
  },

  // ── 问不到模型：5 种外部原因，压成 2 个 kind ────────────────
  "rate-limited-with-hint": {
    name: "rate-limited-with-hint",
    outside: "HTTP 429，响应头带 retry-after",
    expected: failed("unavailable", "number"),
  },
  "rate-limited-no-hint": {
    name: "rate-limited-no-hint",
    outside: "HTTP 429，没有 retry-after —— 退避公式得我们自己算",
    expected: failed("unavailable", "null"),
  },
  "server-error": {
    name: "server-error",
    outside: "HTTP 500 / 529 overloaded",
    expected: failed("unavailable", "null"),
  },
  "network-interrupted": {
    name: "network-interrupted",
    outside: "连接建立后被掐断（socket hang up）",
    expected: failed("unavailable", "null"),
  },
  timeout: {
    name: "timeout",
    outside: "超时。TRAP: 连接超时没花钱，生成到一半超时花了 —— 端口现在分不开",
    expected: failed("unavailable", "null"),
  },
  unauthorized: {
    name: "unauthorized",
    outside: "HTTP 401 / 403：key 错了或没权限。重试没用",
    expected: failed("rejected", "n/a"),
  },
  "bad-request": {
    name: "bad-request",
    outside: "HTTP 400：请求本身不合法（比如 messages 里塞了 role:system）",
    expected: failed("rejected", "n/a"),
  },

  // ── 我们读不懂 ──────────────────────────────────────────────
  malformed: {
    name: "malformed",
    outside: "HTTP 200，但响应压不进五个 kind（未知 stop_reason / 未知工具名）",
    expected: failed("malformed", "n/a"),
  },

  // ── 我们叫停 ────────────────────────────────────────────────
  "aborted-before-send": {
    name: "aborted-before-send",
    outside: "signal 在请求发出去之前就 aborted —— 一个字节都没发",
    expected: failed("aborted", "n/a"),
  },
  "aborted-mid-flight": {
    name: "aborted-mid-flight",
    outside:
      "signal 在请求进行中 aborted —— 请求已经出去了，可能已经计费。" +
      "IMPORTANT: 端口把它和上一条压成同一个 kind，这里是那个洞的登记处",
    expected: failed("aborted", "n/a"),
  },
};

/** 固定顺序的全表，给 it.each 用。 */
export const SCENARIO_LIST: readonly Scenario[] = Object.values(SCENARIOS);
