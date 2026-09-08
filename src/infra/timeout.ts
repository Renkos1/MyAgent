/**
 * 给 {@link LlmPort} 套一层「单次调用超时」——ADR 0021 D5 的下半条。
 *
 * @remarks
 * 为什么是装饰器而不是改用例层：超时是**部署环境的旋钮**，不是领域规则。
 * `runTurn` 关心的是「问一次模型」，不关心那次问最多能等多久 ——
 * 把秒数塞进 `RunConfig` 会让领域配置里混进一个只有运维会调的数。
 *
 * IMPORTANT: 超时被翻译成 `unavailable` 而不是 `aborted`。两者对调用方的意义
 * 完全不同：`unavailable` 可重试且预算退回，`aborted` 是「有人叫停了，别重试」。
 * 分得开的前提是 `AbortSignal.timeout` 的 reason 是 `TimeoutError` ——
 * 和取消用的 reason 不是同一个东西，这是实测过的（见 ts-modern-train
 * docs/libraries/node-http-sse.md 坑⑤）。
 *
 * @see docs/decisions/0021-http-boundary-and-sse.md
 */
import type {
  CallOptions,
  LlmError,
  LlmPort,
  LlmRequest,
  LlmResponse,
  StreamChunk,
} from "../app/ports.ts";
import type { Result } from "../domain/result.ts";
import { err } from "../domain/result.ts";

/**
 * 这一次调用用的信号：客户端的取消 + 我们的超时，合成一个。
 *
 * NOTE: `AbortSignal.any` 每次都返回**新的**信号 —— 复用一个 controller 是
 * 熔断丝的用法（一次 abort 之后永远是 aborted），实测会让整个端点报废。
 */
function armed(
  opts: CallOptions | undefined,
  ms: number,
): { readonly signal: AbortSignal; readonly timeout: AbortSignal } {
  const timeout = AbortSignal.timeout(ms);
  const upstream = opts?.signal;
  return {
    signal:
      upstream === undefined ? timeout : AbortSignal.any([upstream, timeout]),
    timeout,
  };
}

/** 是我们的超时打断的，还是外面那个信号打断的。 */
const timedOut = (timeout: AbortSignal): boolean => timeout.aborted;

/**
 * 把「取消」重新解释成「超时」——只在确实是我们的时钟先响时。
 *
 * IMPORTANT: 判据是 timeout 信号的状态，不是错误的形状。两个信号都可能
 * 让适配器返回同一个 `aborted`，形状上分不出来。
 */
function reinterpret(e: LlmError, timeout: AbortSignal): LlmError {
  if (e.kind !== "aborted" || !timedOut(timeout)) return e;
  return { kind: "unavailable", retryAfterMs: null };
}

/**
 * 包一个 {@link LlmPort}，给每次调用装上独立的超时。
 *
 * @param inner - 真正干活的端口
 * @param ms - 单次调用的时限，毫秒
 * @returns 行为相同、但每次调用最多等 `ms` 的端口
 *
 * @example
 * ```ts
 * const llm = withCallTimeout(createAnthropicLlm(deps), env.upstreamTimeoutMs);
 * ```
 */
export function withCallTimeout(inner: LlmPort, ms: number): LlmPort {
  return {
    capabilities: inner.capabilities,

    async send(
      req: LlmRequest,
      opts?: CallOptions,
    ): Promise<Result<LlmResponse, LlmError>> {
      const { signal, timeout } = armed(opts, ms);
      const res = await inner.send(req, { signal });
      return res.ok ? res : err(reinterpret(res.error, timeout));
    },

    async *stream(
      req: LlmRequest,
      opts?: CallOptions,
    ): AsyncIterable<Result<StreamChunk, LlmError>> {
      const { signal, timeout } = armed(opts, ms);
      for await (const chunk of inner.stream(req, { signal })) {
        yield chunk.ok ? chunk : err(reinterpret(chunk.error, timeout));
      }
    },
  };
}
