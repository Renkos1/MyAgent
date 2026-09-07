/**
 * Anthropic 线格式 ↔ 端口语义，三个纯函数。
 *
 * @remarks
 * IMPORTANT: 这个文件里没有一次网络调用。适配器（阶段 4 后半）负责发请求，
 * 这里只负责**翻译**。分开的理由是可测性：翻译是纯函数，能穷举、能变异检查、
 * 不要 API key；发请求不是。
 *
 * SDK 是翻译器不是编排器 —— 它的重试和循环都不用，用例层已经管了。
 * 版本相关的实测（stop_reason 有七个、默认重试 2 次、retry-after 三种格式）
 * 见 ts-modern-train docs/libraries/anthropic-sdk.md。
 *
 * @see docs/decisions/0017-provider-meta.md  七格 stop_reason + 元数据
 * @see docs/decisions/0018-assistant-turn.md  历史里的 assistant 轮
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  LlmError,
  LlmRequest,
  LlmResponse,
  ProviderMeta,
  ToolCall,
} from "../../app/ports.ts";
import type { Result } from "../../domain/result.ts";
import { err, ok } from "../../domain/result.ts";

// ── 三个工具的线格式定义 ──────────────────────────────────────────

/**
 * 发给模型的工具清单。
 *
 * @remarks
 * IMPORTANT: 名字必须和 {@link ToolCall} 的判别值逐字一致 —— 模型按名字回话，
 * 对不上就会走 {@link toResponse} 的 malformed 分支。
 *
 * NOTE: description 的读者是**模型**，不是人也不是机器解析器。这一类字符串的
 * 语言不按代码规范定，按实测定。
 * TODO(阶段 4): 拿 src/eval/ 跑中文版 vs 英文版的对照，比通过率和 token 用量。
 */
export const TOOLS: readonly Anthropic.Tool[] = [
  {
    name: "list_files",
    description: "列出仓库内某个目录下的文件",
    input_schema: {
      type: "object",
      properties: { dir: { type: "string" } },
      required: ["dir"],
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description: "读取仓库内某个文件的内容",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "search",
    description: "在仓库里按关键词搜索",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
];

// ── ① Message → LlmResponse ──────────────────────────────────────

/** 把 content 里的 text 块拼起来。NOTE: 不 trim —— 「空」由块的有无定义，不由内容。 */
function joinText(content: readonly Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** 一个 tool_use 块能不能收窄成 {@link ToolCall}；收不了返回 null。 */
function toToolCall(b: Anthropic.ToolUseBlock): ToolCall | null {
  const input: unknown = b.input;
  if (typeof input !== "object" || input === null) return null;
  const rec = input as Record<string, unknown>;
  switch (b.name) {
    case "list_files":
      return typeof rec["dir"] === "string"
        ? { name: "list_files", id: b.id, dir: rec["dir"] }
        : null;
    case "read_file":
      return typeof rec["path"] === "string"
        ? { name: "read_file", id: b.id, path: rec["path"] }
        : null;
    case "search":
      return typeof rec["query"] === "string"
        ? { name: "search", id: b.id, query: rec["query"] }
        : null;
    default:
      // IMPORTANT: 模型可以返回任意名字，这个联合不会自己出现（ADR 0007）。
      return null;
  }
}

/**
 * 把供应商的一条 Message 压成端口的 {@link LlmResponse}。
 *
 * @remarks
 * 契约七问的答案：
 *
 * ① 形状 —— 入 `Anthropic.Message`（`stop_reason` 可为 null，只有流式的
 *    message_start 才是 null）；出八格之一，或 `malformed`。
 * ② 失败 —— `Result` 的错误分支，且**只可能是 malformed**：
 *    压不进来意味着我们的代码要改，不是等一下再试。
 * ③ 非法输入 —— stop_reason 为 null / 不认识的 stop_reason /
 *    stop_reason 是 tool_use 但一个 tool_use 块都没有 /
 *    工具名不在三个之内 / 工具参数缺字段或不是字符串。
 * ④ 错误带值 —— malformed 带原样 stop_reason（回填用，SAFETY 见 LlmError）。
 * ⑤ 边界 —— **end_turn 且一个 text 块都没有 ⇒ empty**（ADR 0017 起草时定的 A1）。
 *    有 text 块但内容是空字符串 ⇒ 仍是 completed：
 *    「空」由**块的有无**定义，不由内容定义，所以不 trim。
 * ⑥ 关系 —— infra → app 单向。工具名的收窄在这里发生。
 * ⑦ 留位置 —— 不加参数。
 *
 * IMPORTANT: tool_use 那一轮如果同时带了 text 块，text 直接丢掉 ——
 * 端口的 tool-requested 没有放它的位置（ADR 0017 起草时定的 A6）。
 *
 * @param msg - 供应商返回的一条完整消息
 * @returns 端口语义，或 malformed
 */
export function toResponse(
  msg: Anthropic.Message,
): Result<LlmResponse, LlmError> {
  const meta: ProviderMeta = {
    stopReason: msg.stop_reason,
    refusalCategory: msg.stop_details?.category ?? null,
  };

  switch (msg.stop_reason) {
    case "tool_use": {
      const blocks = msg.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      // 说要调工具却一个块都没有，是响应自相矛盾（ADR 0017 起草时定的 A3）
      if (blocks.length === 0)
        return err({ kind: "malformed", raw: "tool_use" });
      const calls: ToolCall[] = [];
      for (const b of blocks) {
        const call = toToolCall(b);
        if (call === null) return err({ kind: "malformed", raw: "tool_use" });
        calls.push(call);
      }
      return ok({ kind: "tool-requested", calls, meta });
    }

    case "end_turn": {
      const hasText = joinText(msg.content) !== "";
      return hasText
        ? ok({ kind: "completed", text: joinText(msg.content), meta })
        : ok({ kind: "empty", meta });
    }

    case "max_tokens":
      return ok({
        kind: "truncated",
        partialText: joinText(msg.content),
        meta,
      });

    case "model_context_window_exceeded":
      return ok({
        kind: "context-exceeded",
        partialText: joinText(msg.content),
        meta,
      });

    case "pause_turn":
      return ok({ kind: "paused", partialText: "", meta });

    case "stop_sequence":
      return ok({ kind: "stop-sequence", text: joinText(msg.content), meta });

    case "refusal":
      return ok({ kind: "refused", meta });

    default:
      // null（流式的 message_start）或将来新增的 stop_reason 都落这里。
      // raw 留住原文，否则「到底是哪个」永远查不出。
      return err({ kind: "malformed", raw: msg.stop_reason });
  }
}

// ── ② 异常 → LlmError ────────────────────────────────────────────

/**
 * 供应商建议的等待时长，毫秒。
 *
 * @remarks
 * 三种格式，优先级从上到下（实测 SDK 的 client.js 也是这个顺序）：
 *
 * ```text
 * retry-after-ms: "1500"                        毫秒，非标准头
 * retry-after: "2"                              秒
 * retry-after: "Wed, 21 Oct 2026 07:28:00 GMT"  HTTP-date，要减当前时间
 * ```
 *
 * IMPORTANT: 第三种要读时钟，所以 now 必须注入 —— 否则这个函数不纯，
 * 测试要么依赖真实时间，要么得打桩全局 Date。
 * 过去的时间点会得到负数，一律夹成 0（「现在就可以重试」）。
 */
function retryAfterMs(headers: Headers, now: () => number): number | null {
  const after = headers.get("retry-after");
  if (after !== null) {
    const secs = Number.parseFloat(after);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
    const at = Date.parse(after);
    if (!Number.isNaN(at)) return Math.max(0, at - now());
  }
  const ms = headers.get("retry-after-ms");
  if (ms === null) return null;
  const n = Number.parseFloat(ms);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

/** 状态码本身该不该等一下再试。NOTE: 和 SDK 的 shouldRetry 同一张表。 */
function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/**
 * 把 catch 到的东西压成 {@link LlmError}。
 *
 * @remarks
 * 契约七问的答案：
 *
 * ① 形状 —— 入 `unknown`，出 `LlmError`。**不是 Result**：四格总装得下。
 * ② 失败 —— 它自己不失败。
 * ③ 非法输入 —— **不是 APIError 的异常一律原样抛出去**（起草时定的 B2）：
 *    `LlmError` 的四格描述的是「供应商那边怎么了」，我们自己的 bug
 *    塞进去会被 runTurn 当成外部故障计进预算和重试。
 * ④ 错误带值 —— 只有 unavailable 带 retryAfterMs。
 * ⑤ 边界 —— `x-should-retry` 头**推翻**状态码判断，两个方向都听
 *    （起草时定的 B3：服务器说别重试就别重试，说要重试就重试）。
 * ⑥ 关系 —— 全项目唯一 instanceof SDK 错误类的地方。
 * ⑦ 留位置 —— 不加参数。
 *
 * @param e - catch 到的值
 * @param now - 注入的当前时间（毫秒）。见 {@link retryAfterMs} 为什么必须注入
 * @returns 端口的错误语义
 * @throws 原样抛出任何不是 `Anthropic.APIError` 的值
 */
export function toError(e: unknown, now: () => number): LlmError {
  // signal 触发 —— 不是故障，是我们自己叫停的
  if (e instanceof Anthropic.APIUserAbortError) return { kind: "aborted" };
  // 连不上：没有状态码，也没有供应商的建议
  if (e instanceof Anthropic.APIConnectionError) {
    return { kind: "unavailable", retryAfterMs: null };
  }
  if (!(e instanceof Anthropic.APIError)) throw e;

  // NOTE: APIError 的 status / headers 在类型上是泛型参数的默认值，
  //       narrow 之后仍是 any —— 过 unknown 再自己收窄，不然 lint 拦。
  const { status, headers: raw } = e as {
    readonly status?: unknown;
    readonly headers?: unknown;
  };
  const headers = raw instanceof Headers ? raw : new Headers();
  const hint = headers.get("x-should-retry");
  const retryable =
    hint === "true"
      ? true
      : hint === "false"
        ? false
        : typeof status === "number" && retryableStatus(status);

  return retryable
    ? { kind: "unavailable", retryAfterMs: retryAfterMs(headers, now) }
    : { kind: "rejected" };
}

// ── ③ LlmRequest → 线格式 ────────────────────────────────────────

/** 已经排好的请求体片段。system 单独一格，不进 messages。 */
export type WireRequest = {
  readonly system: string;
  readonly messages: readonly Anthropic.MessageParam[];
};

/** 把一条工具结果渲染成线格式的 tool_result 块。 */
function toResultBlock(item: {
  readonly id: string;
  readonly outcome: { readonly kind: string; readonly content?: string };
}): Anthropic.ToolResultBlockParam {
  return {
    type: "tool_result",
    tool_use_id: item.id,
    content: item.outcome.content ?? "",
  };
}

/**
 * 把端口的请求排成供应商要的形状。
 *
 * @remarks
 * 契约七问的答案：
 *
 * ① 形状 —— 入 {@link LlmRequest}，出 {@link WireRequest}。
 *    **不是 1:1** —— 连续的工具结果要合并（见⑤）。
 * ② 失败 —— `Result`，错误是 malformed（起草时定的 C2）：历史形状不合法
 *    是我们自己的 bug，但抛异常会穿过用例层，返回值更好处理。
 * ③ 非法输入 —— 空历史 / 第一条不是 user / 工具结果前面没有 assistant 轮。
 * ④ 错误带值 —— malformed 的 raw 在这里填 null：没有供应商的 stop_reason。
 * ⑤ 边界 —— IMPORTANT: **一轮里所有 tool_result 必须放在同一条 user 消息里**。
 *    拆成多条不报错、不返回 400，只会让模型慢慢不再并发调用工具 ——
 *    没有任何错误信号，见 ts-modern-train docs/libraries/anthropic-sdk.md 坑 6。
 * ⑥ 关系 —— assistant 轮由 ADR 0018 补进 {@link TurnInput}，这里把它还原成
 *    tool_use 块。ToolOutcome 已经被用例层压成文本，所以 is_error 设不上
 *    （TODO(阶段 4)：拿到 key 之后实测 is_error 对模型的影响再决定救不救）。
 * ⑦ 留位置 —— 不加参数。
 *
 * @param req - 端口的请求
 * @returns 线格式，或 malformed
 */
export function toMessages(req: LlmRequest): Result<WireRequest, LlmError> {
  const first = req.history[0];
  if (first === undefined || first.role !== "user") {
    return err({ kind: "malformed", raw: null });
  }

  const messages: Anthropic.MessageParam[] = [];
  let pending: Anthropic.ToolResultBlockParam[] = [];

  /** 把攒着的工具结果一次性放成一条 user 消息。 */
  const flush = (): void => {
    if (pending.length === 0) return;
    messages.push({ role: "user", content: pending });
    pending = [];
  };

  for (const item of req.history) {
    switch (item.role) {
      case "user":
        messages.push({ role: "user", content: item.text });
        break;
      case "assistant":
        flush();
        messages.push({
          role: "assistant",
          content: item.calls.map((c) => ({
            type: "tool_use" as const,
            id: c.id,
            name: c.name,
            input:
              c.name === "list_files"
                ? { dir: c.dir }
                : c.name === "read_file"
                  ? { path: c.path }
                  : { query: c.query },
          })),
        });
        break;
      case "tool-result":
        // 工具结果必须回应前一条 assistant 里的 tool_use（ADR 0018）
        if (messages.at(-1)?.role !== "assistant" && pending.length === 0) {
          return err({ kind: "malformed", raw: null });
        }
        pending.push(toResultBlock(item));
        break;
    }
  }
  flush();

  return ok({ system: req.system, messages });
}
