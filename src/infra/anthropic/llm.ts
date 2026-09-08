/**
 * {@link LlmPort} 的 Anthropic 线格式实现 —— 唯一发网络请求的地方。
 *
 * @remarks
 * 和 `map.ts` 的分工是死的：翻译在那边（纯函数、能穷举），发请求在这边。
 * 这个文件里几乎没有逻辑 —— 它只是把 `toMessages → create → toResponse`
 * 串起来，外加一个 try/catch 交给 `toError`。
 *
 * IMPORTANT: 客户端从外面传进来，这里不读 `process.env`。读环境变量会让
 * 构造过程依赖进程状态，而 baseURL / key 的来源是阶段 5（配置与秘密）的题目。
 * 现在读一次，到时候要拆一次。
 *
 * NOTE: 轮 A 时返回类型是 `Pick<LlmPort, "send">`，轮 D 补上 `stream` 之后
 * 升成完整的 `LlmPort` —— 类型说实话比塞一个 `throw new Error("未实现")` 值钱。
 */
import type Anthropic from "@anthropic-ai/sdk";
import type {
  CallOptions,
  LlmError,
  LlmPort,
  LlmRequest,
  LlmResponse,
  ProviderCapabilities,
  StreamChunk,
} from "../../app/ports.ts";
import type { Result } from "../../domain/result.ts";
import { err, ok } from "../../domain/result.ts";
import type { WireRequest } from "./map.ts";
import { TOOLS, toError, toMessages, toResponse } from "./map.ts";

/**
 * 读一次 signal 的状态。
 *
 * TRAP: 必须通过函数读。`opts?.signal?.aborted` 直接写两次的话，
 * tsc 会把第二次的类型收窄成 `false | undefined` 并跨 await 保留 ——
 * 它是个 getter，值会变，这个收窄是不成立的。
 */
const aborted = (opts: CallOptions | undefined): boolean =>
  opts?.signal?.aborted === true;

/** 造一个适配器要什么。IMPORTANT: 全部显式传入，没有默认的 provider。 */
export type AnthropicLlmDeps = {
  /**
   * 已经配好 baseURL / 认证的 SDK 客户端。
   *
   * IMPORTANT: 造它的时候要传 `maxRetries: 0` —— 重试归用例层管
   * （`runTurn` 的退避 + 预算）。SDK 再重试一层的话，实际请求次数是两层相乘，
   * `RunConfig.maxRetries` 这个配置就在说谎。
   */
  readonly client: Anthropic;
  /** 模型名。DeepSeek 兼容端点按 `claude-*` 的档位映射到自己的模型。 */
  readonly model: string;
  /** 单次响应的 token 上限。线格式必填，没有默认值。 */
  readonly maxTokens: number;
  /**
   * 当前时间，毫秒。注入的理由见 `map.ts` 的 `retryAfterMs` ——
   * `retry-after` 的 HTTP-date 格式要减当前时间。
   */
  readonly now?: () => number;
  /**
   * 这个 baseURL 背后的供应商支持什么。
   *
   * IMPORTANT: 必填，没有默认值 —— 默认成「官方」会让接 DeepSeek 的人
   * 拿到一张错的表，而且不报错。预设见 `./providers.ts`。
   */
  readonly capabilities: ProviderCapabilities;
};

/**
 * 造一个说 Anthropic 线格式的 {@link LlmPort}。
 *
 * @remarks
 * 契约七问里这里只回答一条新的：**⑤ 边界 —— `system` 为空串时不发这个字段**。
 * 其余七问的答案都在 `map.ts` 的三个纯函数上，这里不重复。
 *
 * 空 system 单独处理的理由：线格式允许省略，但不同 provider 对空串的容忍度
 * 不一样（DeepSeek 兼容端点对 `messages[]` 里的 `role:"system"` 直接 400，
 * 顶层 `system` 的行为待实测）。少发一个字段比赌它被忽略便宜。
 *
 * @param deps - 客户端和两个必填参数
 * @returns 完整的 {@link LlmPort}
 *
 * @example
 * ```ts
 * const llm = createAnthropicLlm({
 *   client: new Anthropic({ baseURL, authToken, maxRetries: 0 }),
 *   model: "claude-haiku-4-5-20251001",
 *   maxTokens: 1024,
 * });
 * const res = await llm.send({ system: "", history: [{ role: "user", text: "hi" }] });
 * ```
 */
export function createAnthropicLlm(deps: AnthropicLlmDeps): LlmPort {
  const now = deps.now ?? Date.now;

  /** send 和 stream 共用的请求体。两条路径必须发一模一样的请求。 */
  const body = (
    wire: WireRequest,
  ): Anthropic.MessageCreateParamsNonStreaming => ({
    model: deps.model,
    max_tokens: deps.maxTokens,
    ...(wire.system === "" ? {} : { system: wire.system }),
    messages: [...wire.messages],
    tools: [...TOOLS],
  });

  return {
    capabilities: deps.capabilities,

    async send(
      req: LlmRequest,
      opts?: CallOptions,
    ): Promise<Result<LlmResponse, LlmError>> {
      // 历史形状不合法是我们自己的 bug，一个请求都不用发
      const wire = toMessages(req);
      if (!wire.ok) return wire;
      // IMPORTANT: 发之前拦一道，为的是能诚实地说 sideEffect: "none" ——
      //            交给 SDK 之后再取消，谁都分不清对面开始生成了没有。
      if (aborted(opts)) return err({ kind: "aborted", sideEffect: "none" });

      try {
        const msg = await deps.client.messages.create(body(wire.value), {
          signal: opts?.signal,
        });
        return toResponse(msg);
      } catch (e) {
        // IMPORTANT: toError 只吃 APIError，别的原样抛 —— 我们自己的 bug
        //            不许伪装成供应商故障（map.ts 契约③）。
        return err(toError(e, now));
      }
    },

    async *stream(
      req: LlmRequest,
      opts?: CallOptions,
    ): AsyncIterable<Result<StreamChunk, LlmError>> {
      const wire = toMessages(req);
      if (!wire.ok) {
        yield wire;
        return;
      }
      if (aborted(opts)) {
        yield err<LlmError>({ kind: "aborted", sideEffect: "none" });
        return;
      }

      try {
        const s = deps.client.messages.stream(body(wire.value), {
          signal: opts?.signal,
        });

        for await (const ev of s) {
          // IMPORTANT: 只转 text_delta。thinking_delta 不发 ——
          //            端口的不变量二要求「全部 delta 拼起来 === 结尾块的 text」，
          //            而 text 那一侧是 joinText 拼的，它只认 text 块。
          //            漏掉这个条件，打字机效果里会混进思考过程。
          if (
            ev.type === "content_block_delta" &&
            ev.delta.type === "text_delta"
          )
            yield ok({ kind: "text", delta: ev.delta.text });
        }

        // NOTE: 用 SDK 的 finalMessage 而不是自己攒块 —— 攒块等于把 toResponse
        //       的输入重新实现一遍，两条路径的结局就可能不一致（不变量一）。
        const final = await s.finalMessage();
        const res = toResponse(final);
        yield res.ok ? ok({ kind: "end", response: res.value }) : res;
      } catch (e) {
        yield err(toError(e, now));
      }
    },
  };
}
