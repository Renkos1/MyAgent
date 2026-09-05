/**
 * 端口 —— 用例层对外界的全部要求，★用领域的词汇写★。
 *
 * 这个文件里没有一行实现。它存在的唯一目的是：
 * ★让 app 依赖接口、让 infra 依赖 app，箭头方向反过来。★
 * 门禁在 .dependency-cruiser.cjs 的 `app-不许碰-infra`。
 *
 * ── 契约 ────────────────────────────────────────────────────────
 *
 * ① 端口返回什么形状？
 *      ★判别联合，payload 塞进 kind 里★（候选 c）。
 *      理由：completed 必须带 text（不然答案从哪来），tool-requested 必须带
 *            calls，而 empty 两个都没有 —— ★三个字段并列会让
 *            "completed 但 text 是 undefined" 写得出来★。
 *      代价：★app 和 domain 出现了两个平行的联合★（LlmResponse / TurnOutcome）。
 *            两份平行结构会各自漂移 —— 这是 loop.ts / turn.ts 已经踩过的坑。
 *            对策见契约②：编译期钉死，不靠自觉。
 *
 * ② 两个联合怎么保证不漂？
 *      ★类型层断言★：KindsMatch 要求两边的 kind 集合互相包含。
 *      加一个 kind 到任一边而不加另一边，★tsc 直接红★。
 *      判据（engineering/19 那把尺子）：这是★结构性标记★，不是注释。
 *      代价：多一个只为编译期存在的常量，运行时是死代码。
 *
 * ③ 网络失败算哪一类？
 *      ★端口失败，走 Result<_, LlmError>★，★decide 看不见它★。
 *      理由：decide 的输入是「模型那边发生了什么」；HTTP 500 是
 *            「我们没能问到模型」—— 连一轮都没发生，没有可裁决的东西。
 *      代价：用例层要写两层判断（先 result.ok，再 decide）。
 *
 * ④ LlmError 怎么分类？
 *      ★按调用方要做什么分，不按 HTTP 状态码分。★
 *      沿用 path.ts 契约的同一条：kind 描述失败的原因，不描述失败的形状。
 *      429 和 503 在代码里是同一件事（等一下再试），就该是同一个 kind。
 *      ⚠ malformed 是★适配器自己的失败★：它没能把供应商响应压成五个 kind。
 *        单独一个 kind，因为它意味着★我们的代码要改★，不是等一下再试。
 *
 * ⑤ 历史谁维护？
 *      ★端口收「这一轮的增量」★。
 *      推论（★这一条是被③选出来的，不是自由选的★）：provider 的 HTTP API
 *      是无状态的，每次都要发全量历史 —— 收增量就意味着★累加的活在适配器里★。
 *      所以端口★有状态★，而有状态的东西不能藏：
 *      开一个 LlmSession 类型，把「这是一次对话」写在名字上。
 *      代价：· 每轮对话要 new 一个 session，composition root 要管生命周期
 *            · 「回退一轮重来」变难 —— 历史在适配器肚子里
 *            · 一个 session 不能并发用（阶段 6 接 HTTP 时会踩到）
 *      ⚠ 这里★不能用圈号当列表符★：换行后圈号落到行首，
 *        会被 check-contracts 当成一条新的契约声明（本文件真踩过）。
 *      ★重新考虑的信号★：需要「编辑上一条消息重发」或「分支对话」时。
 *
 * ⑥ 流式和非流式怎么共存？
 *      ★两个方法并存★：send 返回 Promise，stream 返回 AsyncIterable。
 *      理由：阶段 6 才做 SSE，但★方法签名是难回退的★ ——
 *            以后把 Promise 改成 AsyncIterable，所有调用点都要改。
 *      代价：适配器要实现两遍；两条路径的错误处理容易不一致
 *            （阶段 3 的契约测试要同时打这两条）。
 *
 * ⑦ 取消怎么传？
 *      ★现在就留 AbortSignal★，即使阶段 2 没人传。
 *      理由：roadmap 阶段 6 验收明写「Ctrl-C 后服务端真的停止调用模型」，
 *            而且验证方式是★去 provider 后台看 token 用量★ ——
 *            信号断在中间是查不出来的，只能靠一路传到底。
 *      同类：决策 3 的 actor 口子。★留口子便宜，改签名贵。★
 *
 * ⑧ 工具名是 string 还是联合？
 *      ★联合类型 ToolName★。
 *      ⚠ 模型返回的是★任意字符串★，联合类型不会自己出现 ——
 *        ★收窄的动作发生在适配器里★，和契约①「压成五个 kind」是同一个动作。
 *        收不进来的名字 → LlmError.malformed。
 *      收益：ToolCall 按 name 判别，★每个工具的参数各自定型★，
 *            read_file 拿不到 dir、list_files 拿不到 query。
 *
 * ⑨ 工具执行失败算什么？
 *      ★正常返回值，不是端口失败★（所以 run 不返回 Result）。
 *      理由：领域规则里「工具失败的处理策略」有一项是★告诉模型★ ——
 *            要喂回给模型的东西，本来就是数据。
 *      ⚠ ★failed 的 cause 是闭集，不是自由文本。★
 *        路径是模型/用户给的值，塞进自由文本就会原样进日志。
 *        同一条不变量：path.ts 的 PathError 只带 kind，不带那个路径。
 *        （日志脱敏规则阶段 8 才定 —— ★在那之前不许放自由文本进来★。）
 */
import type { PathError } from "../domain/path.ts";
import type { Result } from "../domain/result.ts";
import type { TurnOutcome } from "../domain/turn.ts";

// ── LLM 端口 ──────────────────────────────────────────────────────

/** 三个工具。契约⑧：联合类型，收窄发生在适配器。 */
export type ToolName = "list_files" | "read_file" | "search";

/** 契约⑧：按 name 判别，参数各自定型。id 用来把结果配回请求。 */
export type ToolCall =
  | { readonly name: "list_files"; readonly id: string; readonly dir: string }
  | { readonly name: "read_file"; readonly id: string; readonly path: string }
  | { readonly name: "search"; readonly id: string; readonly query: string };

/**
 * 模型这一轮说了什么。契约①：payload 在 kind 里。
 * ★kind 集合必须和 domain 的 TurnOutcome 一致★，由契约②的 KindsMatch 钉死。
 */
export type LlmResponse =
  | { readonly kind: "tool-requested"; readonly calls: readonly ToolCall[] }
  | { readonly kind: "completed"; readonly text: string }
  /** 契约：半句话不是答案（turn.ts 契约④），但★留着给调用方展示★。 */
  | { readonly kind: "truncated"; readonly partialText: string }
  | { readonly kind: "refused" }
  | { readonly kind: "empty" };

/** 契约④：按「调用方要做什么」分类。 */
export type LlmError =
  /** 等一下再试：429 / 5xx / 网络中断。retryAfterMs 是供应商给的建议。 */
  | { readonly kind: "unavailable"; readonly retryAfterMs: number | null }
  /** 重试没用：401 / 403 / 请求本身不合法。 */
  | { readonly kind: "rejected" }
  /** signal 触发。★不是错误，是我们自己叫停的★，但调用方要能分辨。 */
  | { readonly kind: "aborted" }
  /** ★适配器没能把响应压成五个 kind 之一 —— 我们的代码要改。★ */
  | { readonly kind: "malformed" };

/** 契约⑦：现在就留，阶段 2 没人传。 */
export type CallOptions = { readonly signal?: AbortSignal };

/** 流式的一块。契约⑥：和 send 并存，最后一块带完整的 LlmResponse。 */
export type StreamChunk =
  | { readonly kind: "text"; readonly delta: string }
  | { readonly kind: "end"; readonly response: LlmResponse };

/**
 * ★一次对话★。契约⑤：端口收增量，所以历史累加在适配器里 —— 它有状态。
 * ⚠ 一个 session 不能并发用。
 */
export interface LlmSession {
  /** 契约③：Result 的错误分支是「没问到模型」，不是「模型说了坏消息」。 */
  send(
    delta: readonly TurnInput[],
    opts?: CallOptions,
  ): Promise<Result<LlmResponse, LlmError>>;

  /** 契约⑥：流式。错误同样走 Result，在最后一块之前可能提前结束。 */
  stream(
    delta: readonly TurnInput[],
    opts?: CallOptions,
  ): AsyncIterable<Result<StreamChunk, LlmError>>;
}

/** 喂给模型的增量。契约⑤：只有这一轮新增的东西。 */
export type TurnInput =
  | { readonly role: "user"; readonly text: string }
  | {
      readonly role: "tool-result";
      readonly id: string;
      readonly outcome: ToolOutcome;
    };

/** composition root 用它开对话；只有它知道 provider 是谁。 */
export interface LlmPort {
  startSession(systemPrompt: string): LlmSession;
}

// ── 工具端口 ──────────────────────────────────────────────────────

/**
 * 工具跑完的结果。契约⑨：★失败是数据，不是异常，也不是 Result 的错误分支★。
 */
export type ToolOutcome =
  | { readonly kind: "ok"; readonly content: string }
  /** 路径校验拒绝。★直接复用领域类型★，不抄一份同形状的。 */
  | { readonly kind: "denied"; readonly reason: PathError }
  | { readonly kind: "not-found" }
  | {
      readonly kind: "too-large";
      readonly bytes: number;
      readonly max: number;
    }
  /** 契约⑨：cause 是★闭集★ —— 自由文本会把模型给的路径原样带进日志。 */
  | {
      readonly kind: "failed";
      readonly cause: "io-error" | "timeout" | "unknown";
    };

export interface ToolPort {
  run(call: ToolCall, opts?: CallOptions): Promise<ToolOutcome>;
}

// ── 契约②：编译期钉死两个联合的 kind 集合 ─────────────────────────

/** 双向包含。任一边加了 kind 而另一边没加，这个类型就变成 never。 */
type KindsMatch = [TurnOutcome["kind"]] extends [LlmResponse["kind"]]
  ? [LlmResponse["kind"]] extends [TurnOutcome["kind"]]
    ? true
    : never
  : never;

/** ★这一行是门禁★：不一致时 tsc 报 "Type 'true' is not assignable to type 'never'"。 */
const _kindsMatch: KindsMatch = true;
void _kindsMatch;

/**
 * 把端口的响应投影成领域能吃的 TurnOutcome —— ★丢掉 payload★。
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
