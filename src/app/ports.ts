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
 * 供应商附带的元数据，和语义分开存。
 *
 * @remarks
 * SAFETY: 两个字段都只放**闭集里的短标识符或 null**，绝不放自由文本 ——
 * 同 {@link ToolOutcome} 的 `cause`。日志脱敏规则阶段 8 才定，在那之前
 * 放进来的自由文本会原样进日志。
 *
 * NOTE: A4 给 pause_turn / stop_sequence 各开一格之后，kind 反过来能确定
 * stopReason，所以这个字段现在主要是**未来的回填口子**：出现我们没见过的
 * stop_reason 时，语义走 malformed，原文留在这里。真正不可还原的是
 * refusalCategory。
 *
 * @see docs/decisions/0017-provider-meta.md
 */
export type ProviderMeta = {
  /** 供应商原样的 stop_reason；自己造的响应填 null。 */
  readonly stopReason: string | null;
  /** refusal 的分类（如 "cyber"）；不是 refusal 或供应商没给就是 null。 */
  readonly refusalCategory: string | null;
};

/** 没有供应商的场合用它：Fake、组合根、测试。 */
export const NO_META: ProviderMeta = {
  stopReason: null,
  refusalCategory: null,
};

/**
 * 模型这一轮说了什么。payload 塞在 kind 里，不三个字段并列。
 *
 * @remarks
 * IMPORTANT: kind 集合必须和 domain 的 {@link TurnOutcome} 一致，
 * 由下面的 `KindsMatch` 在编译期钉死。
 *
 * 每一格都带 {@link ProviderMeta}，语义和元数据分开 ——
 * 语义决定调用方做什么，元数据只为回填和排障。
 */
export type LlmResponse = { readonly meta: ProviderMeta } & (
  | {
      readonly kind: "tool-requested";
      readonly calls: readonly ToolCall[];
      /**
       * 不透明续传令牌 —— 原样带回去，不许看、不许解释。
       *
       * @remarks
       * IMPORTANT: 唯一的合法用法是把它塞进 {@link TurnInput} 的 assistant 那一格，
       * 让适配器还给供应商。用例层读它、判断它、根据它分支，都是 bug。
       *
       * 为什么必须存在：thinking 块带 signature，**造不出来也丢不得** ——
       * 端口的词汇（{@link ToolCall}）重建不了它，而供应商要验。
       * 这和 cookie / 分页 cursor / refresh token 是同一个形状。
       *
       * NOTE: 2026-09 实测，DeepSeek 兼容端点丢掉 thinking 块**不报错**
       * （见 scripts/probe-roundtrip.ts）。留这个字段是为了 Anthropic 官方
       * 和「签名存在就说明有人会验」这条推断，不是为了当下的某个 400。
       * @see docs/decisions/0019-opaque-continuation.md
       */
      readonly opaque?: readonly unknown[];
    }
  | { readonly kind: "completed"; readonly text: string }
  /** 半句话不是答案（见 ADR 0006 §④），但留着给调用方展示。 */
  | { readonly kind: "truncated"; readonly partialText: string }
  /**
   * 上下文窗口在生成途中被撑满。partialText 的地位同 truncated。
   *
   * @remarks
   * IMPORTANT: 它是供应商的成功响应，不是错误 —— 所以不在 {@link LlmError} 里。
   * 判据是端口自己的那条：错误分支表示「没问到模型」，这一支问到了。
   * @see docs/decisions/0016-context-exceeded.md
   */
  | { readonly kind: "context-exceeded"; readonly partialText: string }
  /**
   * 供应商把这一轮暂停了（server tool 跑太久）。
   *
   * @remarks
   * NOTE: 本项目不用 server tool，所以它**不该出现**。各开一格而不是压进
   * malformed，是为了真出现时错误信息说得清是哪一个。
   * IMPORTANT: 线格式上它是可续的（把 assistant 那轮原样发回去），
   * 但我们没有续的路径，所以 decide 把它判成 aborted。
   * @see docs/decisions/0017-provider-meta.md
   */
  | { readonly kind: "paused"; readonly partialText: string }
  /**
   * 撞上了自定义停止序列。
   *
   * @remarks
   * NOTE: 我们一个 stop_sequences 都没设，所以它同样**不该出现**。
   * 出现说明请求不是我们以为的那个请求。
   */
  | { readonly kind: "stop-sequence"; readonly text: string }
  | { readonly kind: "refused" }
  | { readonly kind: "empty" }
);

/** 按「调用方要做什么」分类，不按 HTTP 状态码分。 */
export type LlmError =
  /** 等一下再试：429 / 5xx / 网络中断。retryAfterMs 是供应商给的建议。 */
  | { readonly kind: "unavailable"; readonly retryAfterMs: number | null }
  /** 重试没用：401 / 403 / 请求本身不合法。 */
  | { readonly kind: "rejected" }
  /**
   * signal 触发。NOTE: 不是错误，是我们自己叫停的，但调用方要能分辨。
   *
   * @remarks
   * IMPORTANT: `sideEffect` 和 {@link ToolOutcome} 那一格同形，判据也同一条 ——
   * 请求发出去之前被叫停是 `none`（一个 token 都没产生，预算退得回来），
   * 发出去之后是 `unknown`（对面可能已经生成了一部分，退不得）。
   *
   * 阶段 6 之前这一格只有一种来源（我们自己 abort），所以压成一格没有代价。
   * 有了 HTTP 之后它每天都会发生 —— 用户关页面就是一次，而「关得早」和
   * 「关得晚」在账单上是两回事。
   * @see docs/decisions/0021-http-boundary-and-sse.md
   * @see docs/decisions/0015-aborted-side-effect.md
   */
  | { readonly kind: "aborted"; readonly sideEffect: "none" | "unknown" }
  /**
   * IMPORTANT: 适配器没能把响应压成 {@link LlmResponse} 的某一格 ——
   * 我们的代码要改，不是等一下再试。
   *
   * @remarks
   * `raw` 是供应商原样的 stop_reason，没有就是 null。它存在的唯一理由是
   * **回填**：出现我们没见过的 stop_reason 时，语义只能走这一支，
   * 而「到底是哪个」不留下来就永远查不出。
   *
   * SAFETY: 只放供应商的 stop_reason 这种短标识符，不放消息体、不放路径 ——
   * 同 {@link ProviderMeta} 的那条不变量。
   * @see docs/decisions/0017-provider-meta.md
   */
  | { readonly kind: "malformed"; readonly raw: string | null };

/** 现在就留，阶段 2 没人传 —— 留口子便宜，改签名贵。 */
export type CallOptions = { readonly signal?: AbortSignal };

/**
 * 流式的一块。和 send 并存，最后一块带完整的 {@link LlmResponse}。
 *
 * @remarks
 * IMPORTANT: 两条不变量，契约套件逐个实现验：
 * 1. 结局必须和 send 落在同一个 kind —— 同一件事经两条路径不许有两种说法。
 * 2. kind 是 completed 时，全部 text 块的 delta 拼起来必须等于结尾块的 text ——
 *    否则打字机效果显示的和最终答案是两句话。
 *
 * TODO(阶段 4): truncated 的 partialText 要不要也走 text 块？真适配器一定会发
 * （截断之前的文本已经流出去了），FakeLlm 不发 —— 契约现在没说，接真模型时定。
 *
 * TODO(阶段 5 之前): **tool-requested 那一轮流式该不该吐 text 块，这里没规定。**
 * 上面两条不变量都只管 completed，于是契约套件断言中间块的那条测试也只对
 * completed 跑。实测代价：把 stream 的过滤条件放宽成「thinking_delta 也发」，
 * tool-requested 那盘带子真吐出 35 个 text 块，37 个断言一个没红。
 * 现在靠 test/infra/streamFilter.test.ts 单独摁住，但那是补丁不是契约。
 */
export type StreamChunk =
  | { readonly kind: "text"; readonly delta: string }
  | { readonly kind: "end"; readonly response: LlmResponse };

/** 对话里的一条。用例层攒着它们，每次把全部发出去。 */
export type TurnInput =
  | { readonly role: "user"; readonly text: string }
  /**
   * 模型上一轮要求的工具调用，原样记进历史。
   *
   * @remarks
   * IMPORTANT: 这一格不是为了好看 —— 没有它，适配器**造不出合法请求**。
   * 供应商的线格式要求「工具结果」必须回应前一条 assistant 消息里的
   * 工具调用块，而 ADR 0004 之后历史里只有 user 和 tool-result 两种角色，
   * 那条 assistant 消息无处可存。
   *
   * 存的是端口自己的 {@link ToolCall}，不是供应商的原始块 ——
   * 供应商的形状不许漏进 app 层，重建交给适配器。
   * @see docs/decisions/0018-assistant-turn.md
   */
  | {
      readonly role: "assistant";
      readonly calls: readonly ToolCall[];
      /**
       * 上一轮响应里那份 {@link LlmResponse} 的 `opaque`，原样搬过来。
       *
       * IMPORTANT: 用例层的职责到「搬」为止 —— 不看内容、不做判断。
       * 缺了它在 DeepSeek 上没事，在会验签的供应商上是 400。
       */
      readonly opaque?: readonly unknown[];
    }
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
 * 一项能力的支持情况。
 *
 * @remarks
 * IMPORTANT: 三态，不是布尔。`unknown` 表示**我们还没测过** ——
 * 它和 `no` 是两件事：`no` 是「测过，不支持」，`unknown` 是「不知道，
 * 谁依赖它谁自己去测」。把没测过的写成 `no` 会让后面的人以为有结论。
 *
 * 同一条不变量见 {@link ToolOutcome} 的 `sideEffect: "unknown"`
 * 和 {@link LlmError} 的 `malformed.raw`：**把「不知道」写进类型**。
 */
export type Support = "yes" | "no" | "unknown";

/**
 * 一个供应商实际支持什么。
 *
 * @remarks
 * IMPORTANT: 每一格都必须由**实测**填，不许照文档抄 ——
 * 「线格式相同 ≠ 能力相同」是阶段 4 的核心命题，而文档描述的是线格式。
 * 每一格旁边要能指出是哪个 `scripts/probe-*.ts` 测出来的。
 *
 * 它是端口的一部分而不是适配器的私有属性，因为**调用方要据此分支**：
 * 不支持并发就没必要开并发工具，不支持对话中系统消息就得换一种
 * 传运营指令的办法。
 */
export type ProviderCapabilities = {
  /** 会不会返回 tool_use。probe-tools ① */
  readonly toolUse: Support;
  /** 一条 assistant 消息里能不能有多个 tool_use。probe-tools ② */
  readonly parallelToolUse: Support;
  /** 流式，且满足 {@link StreamChunk} 的两条不变量。probe-stream */
  readonly streaming: Support;
  /** `messages[]` 里的 `role:"system"`（对话中系统消息）。 */
  readonly midConversationSystem: Support;
  /**
   * 提示缓存。`automatic` = 不传 cache_control 也会缓存。probe-tools 的 usage
   *
   * NOTE: 这一格不是 {@link Support} —— 「自动」和「要显式打断点」
   * 对调用方是两种不同的活，压成 yes 就丢了这个区别。
   */
  readonly promptCaching: "none" | "automatic" | "explicit" | "unknown";
  /**
   * 丢掉 thinking 块再发回去会不会被拒。probe-roundtrip
   *
   * IMPORTANT: `no` 不等于「可以丢」—— 块上带着 signature，
   * 换一个供应商就可能变成 `yes`。这一格存在的意义是解释
   * 为什么 `opaque` 这条通路在这里看起来是多余的。
   * @see docs/decisions/0019-opaque-continuation.md
   */
  readonly verifiesThinkingSignature: Support;
  /**
   * 模型名不存在时会不会拒绝。probe-errors ②
   *
   * SAFETY: `no` 是一个**危险**的取值 —— 模型名打错不报错，
   * 请求会被别的模型接走，而且没有任何信号。
   */
  readonly validatesModelName: Support;
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
  /**
   * 这个实现背后的供应商支持什么。
   *
   * IMPORTANT: 必填。省略它就等于把能力差异留在文档里，
   * 而文档不会在编译期提醒任何人。
   */
  readonly capabilities: ProviderCapabilities;

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
    }
  /**
   * 我们自己叫停的。IMPORTANT: 取消不是失败 —— 调用方对这两者的处理不同：
   * 不记进错误率、不重试、不该告诉模型「工具坏了」。
   *
   * `sideEffect` 回答调用方真正要决定的那件事：**重试安全吗、要不要记账、
   * 跟模型怎么说**。三个问题的答案都只取决于「副作用发生了没有」。
   *
   * IMPORTANT: 只有两格，而且第二格叫 `unknown` 不叫 `happened` ——
   * 跑到一半被叫停时，我们**真的不知道**对面做完没有。这就是第三态
   * （见 ts-modern-train docs/MAP.md 图 6）：把「不知道」写进类型，
   * 调用方就不可能把它当成「没发生」处理。
   *
   * @see docs/decisions/0015-aborted-side-effect.md  取代 0014 §②
   */
  | {
      readonly kind: "aborted";
      /** none = 一步都没跑，重试安全；unknown = 已经开始，结局不明，重试不安全。 */
      readonly sideEffect: "none" | "unknown";
    };

/**
 * 跑一个工具，把结果压成 {@link ToolOutcome}。
 *
 * @remarks
 * 和 {@link LlmPort} 同一条规矩：端口无状态。IMPORTANT: 它不抛异常 ——
 * 失败也是返回值，取消也是。opts.signal 在**进来之前**就 aborted 时返回
 * `{ kind: "aborted", sideEffect: "none" }`；开跑之后才被叫停返回
 * `sideEffect: "unknown"`。两种都不许抛 AbortError（契约套件会验）。
 * 并发上限、预算、重试都在用例层，适配器不许自己决定。
 * @see docs/decisions/0007-port-shapes.md
 * @see docs/decisions/0014-tool-outcome-aborted.md
 * @see docs/decisions/0015-aborted-side-effect.md
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
 * NOTE: 运行时是死代码 —— 覆盖率会缺这一行，变异测试也永远杀不掉它
 * （`true` 改成 `false` 只影响编译，不影响运行）。
 * 同 `eval/parse.ts` 的 `ToolNamesMatch`。
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
    case "context-exceeded":
      return { kind: "context-exceeded" };
    case "paused":
      return { kind: "paused" };
    case "stop-sequence":
      return { kind: "stop-sequence" };
    case "refused":
      return { kind: "refused" };
    case "empty":
      return { kind: "empty" };
  }
}
