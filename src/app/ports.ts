/**
 * 端口 —— 用例层对外界的全部要求，用领域的词汇写。
 *
 * @remarks
 * 这个文件里没有一行实现。它存在的唯一目的是让箭头方向反过来：
 * app 依赖接口，infra 依赖 app。门禁在 `.dependency-cruiser.cjs` 的
 * `app-不许碰-infra`。
 *
 * 阶段 1 的 {@link TurnOutcome} 已经替这些形状定死了一半 ——
 * 端口不是新发明的东西，是领域已经开口要的东西。
 *
 * @see docs/decisions/0007-port-shapes.md  九个决定的候选、判据、代价
 * @see docs/decisions/0004-history-ownership.md  为什么端口无状态
 */
import type { PathError } from "../domain/path.ts";
import type { Result } from "../domain/result.ts";
import type { TurnOutcome } from "../domain/turn.ts";

// ── LLM 端口 ──────────────────────────────────────────────────────

/**
 * 三个工具。
 *
 * @remarks
 * IMPORTANT: 模型返回的是任意字符串，这个联合不会自己出现 ——
 * 收窄的动作发生在适配器里，收不进来的名字变成 {@link LlmError} 的 `malformed`。
 */
export type ToolName = "list_files" | "read_file" | "search";

/** 按 name 判别，每个工具的参数各自定型。id 用来把结果配回请求。 */
export type ToolCall =
  | { readonly name: "list_files"; readonly id: string; readonly dir: string }
  | { readonly name: "read_file"; readonly id: string; readonly path: string }
  | { readonly name: "search"; readonly id: string; readonly query: string };

/**
 * 模型这一轮说了什么。payload 塞在 kind 里，不三个字段并列。
 *
 * @remarks
 * IMPORTANT: kind 集合必须和 domain 的 {@link TurnOutcome} 一致，
 * 由下面的 `KindsMatch` 在编译期钉死。
 */
export type LlmResponse =
  | { readonly kind: "tool-requested"; readonly calls: readonly ToolCall[] }
  | { readonly kind: "completed"; readonly text: string }
  /** 半句话不是答案（见 ADR 0006 §④），但留着给调用方展示。 */
  | { readonly kind: "truncated"; readonly partialText: string }
  | { readonly kind: "refused" }
  | { readonly kind: "empty" };

/** 按「调用方要做什么」分类，不按 HTTP 状态码分。 */
export type LlmError =
  /** 等一下再试：429 / 5xx / 网络中断。retryAfterMs 是供应商给的建议。 */
  | { readonly kind: "unavailable"; readonly retryAfterMs: number | null }
  /** 重试没用：401 / 403 / 请求本身不合法。 */
  | { readonly kind: "rejected" }
  /** signal 触发。NOTE: 不是错误，是我们自己叫停的，但调用方要能分辨。 */
  | { readonly kind: "aborted" }
  /** IMPORTANT: 适配器没能把响应压成五个 kind 之一 —— 我们的代码要改，不是等一下再试。 */
  | { readonly kind: "malformed" };

/** 现在就留，阶段 2 没人传 —— 留口子便宜，改签名贵。 */
export type CallOptions = { readonly signal?: AbortSignal };

/** 流式的一块。和 send 并存，最后一块带完整的 {@link LlmResponse}。 */
export type StreamChunk =
  | { readonly kind: "text"; readonly delta: string }
  | { readonly kind: "end"; readonly response: LlmResponse };

/** 对话里的一条。用例层攒着它们，每次把全部发出去。 */
export type TurnInput =
  | { readonly role: "user"; readonly text: string }
  | {
      readonly role: "tool-result";
      readonly id: string;
      readonly outcome: ToolOutcome;
    };

/**
 * 一次请求的全部内容。
 *
 * @remarks
 * history 是到目前为止的全部对话，不是增量。
 * 这决定了端口是无状态的 —— 见 docs/decisions/0004-history-ownership.md。
 */
export type LlmRequest = {
  readonly system: string;
  readonly history: readonly TurnInput[];
};

/**
 * 问模型。
 *
 * @remarks
 * IMPORTANT: 端口无状态。同一个实例可以被并发使用，不需要「开一次对话」。
 * 历史归用例层所有，所以「回退一轮重来」「编辑上一条重发」都只是换一个数组。
 *
 * Result 的错误分支表示「没问到模型」（网络、鉴权、我们读不懂响应），
 * 不表示「模型说了坏消息」—— 后者是 {@link LlmResponse} 的一个 kind。
 *
 * @see docs/decisions/0004-history-ownership.md  为什么历史归用例层
 */
export interface LlmPort {
  send(
    req: LlmRequest,
    opts?: CallOptions,
  ): Promise<Result<LlmResponse, LlmError>>;

  /** 流式。错误同样走 Result，在最后一块之前可能提前结束。 */
  stream(
    req: LlmRequest,
    opts?: CallOptions,
  ): AsyncIterable<Result<StreamChunk, LlmError>>;
}

// ── 工具端口 ──────────────────────────────────────────────────────

/**
 * 工具跑完的结果。
 *
 * @remarks
 * IMPORTANT: 失败是数据，不是异常，也不是 Result 的错误分支 ——
 * 领域规则里「工具失败的处理策略」有一项是告诉模型，那就本来是数据。
 */
export type ToolOutcome =
  | { readonly kind: "ok"; readonly content: string }
  /** 路径校验拒绝。直接复用领域类型，不抄一份同形状的。 */
  | { readonly kind: "denied"; readonly reason: PathError }
  | { readonly kind: "not-found" }
  | {
      readonly kind: "too-large";
      readonly bytes: number;
      readonly max: number;
    }
  /**
   * SAFETY: cause 是闭集，不是自由文本 —— 路径是模型/用户给的值，
   * 塞进自由文本就会原样进日志。同一条不变量见 PathError。
   * 日志脱敏规则阶段 8 才定，在那之前不许放自由文本进来。
   */
  | {
      readonly kind: "failed";
      readonly cause: "io-error" | "timeout" | "unknown";
    };

/**
 * 跑一个工具，把结果压成 {@link ToolOutcome}。
 *
 * @remarks
 * 和 {@link LlmPort} 同一条规矩：端口无状态，也★不抛异常★ ——
 * 失败也是返回值。并发上限、预算、重试都在用例层，适配器不许自己决定。
 * @see docs/decisions/0007-port-shapes.md
 */
export interface ToolPort {
  run(call: ToolCall, opts?: CallOptions): Promise<ToolOutcome>;
}

// ── 编译期钉死两个联合的 kind 集合（ADR 0007 §②）──────────────────

/** 双向包含。任一边加了 kind 而另一边没加，这个类型就变成 never。 */
type KindsMatch = [TurnOutcome["kind"]] extends [LlmResponse["kind"]]
  ? [LlmResponse["kind"]] extends [TurnOutcome["kind"]]
    ? true
    : never
  : never;

/**
 * IMPORTANT: 这一行是门禁。不一致时 tsc 报
 * `Type 'true' is not assignable to type 'never'`。
 * NOTE: 运行时是死代码 —— 覆盖率会缺这一行。
 */
const _kindsMatch: KindsMatch = true;
void _kindsMatch;

/**
 * 把端口的响应投影成领域能吃的 {@link TurnOutcome}，丢掉 payload。
 *
 * @remarks
 * 这是「适配器压成五个 kind」的下半段：上半段在 infra，这半段在 app。
 */
export function toOutcome(res: LlmResponse): TurnOutcome {
  switch (res.kind) {
    case "tool-requested":
      return { kind: "tool-requested", toolCount: res.calls.length };
    case "completed":
      return { kind: "completed" };
    case "truncated":
      return { kind: "truncated" };
    case "refused":
      return { kind: "refused" };
    case "empty":
      return { kind: "empty" };
  }
}
