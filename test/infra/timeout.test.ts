/**
 * 单次调用超时的装饰器（ADR 0021 D5 的下半条）。
 *
 * IMPORTANT: 这里考的是**一个分不出形状的区别** —— 超时和取消让适配器返回的
 * 东西一模一样（都是 aborted），只有 signal 的 reason 能区分。
 * 分错的代价是真的：超时判成 aborted 就不会重试也不退预算。
 */
import { describe, expect, it } from "vitest";

import type {
  CallOptions,
  LlmError,
  LlmPort,
  LlmRequest,
  LlmResponse,
  ProviderCapabilities,
  StreamChunk,
} from "../../src/app/ports.ts";
import { NO_META } from "../../src/app/ports.ts";
import type { Result } from "../../src/domain/result.ts";
import { err, ok } from "../../src/domain/result.ts";
import { withCallTimeout } from "../../src/infra/timeout.ts";

const CAPS: ProviderCapabilities = {
  toolUse: "yes",
  parallelToolUse: "yes",
  streaming: "yes",
  midConversationSystem: "yes",
  promptCaching: "none",
  verifiesThinkingSignature: "no",
  validatesModelName: "yes",
};

const REQ: LlmRequest = { system: "", history: [{ role: "user", text: "hi" }] };

/** 一个「等着等着就被 signal 打断」的端口 —— 真适配器在超时下就是这个行为。 */
class Sleepy implements LlmPort {
  readonly capabilities = CAPS;
  /** 每次调用收到的 signal，测试用它确认外面传进来的确实被合并了。 */
  readonly seen: (AbortSignal | undefined)[] = [];

  private readonly waitMs: number;

  // TRAP: 不能写成参数属性 —— Node 的类型擦除是 strip-only，
  //       `constructor(private readonly waitMs: number)` 要生成一句赋值，
  //       运行时直接 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX，而 tsc 不会报。
  constructor(waitMs: number) {
    this.waitMs = waitMs;
  }

  async send(
    _req: LlmRequest,
    opts?: CallOptions,
  ): Promise<Result<LlmResponse, LlmError>> {
    this.seen.push(opts?.signal);
    const hit = await raceSignal(this.waitMs, opts?.signal);
    return hit
      ? err({ kind: "aborted", sideEffect: "unknown" })
      : ok({ kind: "completed", meta: NO_META, text: "答案" });
  }

  async *stream(
    _req: LlmRequest,
    opts?: CallOptions,
  ): AsyncIterable<Result<StreamChunk, LlmError>> {
    this.seen.push(opts?.signal);
    const hit = await raceSignal(this.waitMs, opts?.signal);
    if (hit) {
      yield err<LlmError>({ kind: "aborted", sideEffect: "unknown" });
      return;
    }
    yield ok<StreamChunk>({
      kind: "end",
      response: { kind: "completed", meta: NO_META, text: "答案" },
    });
  }
}

/** 等 ms，或者等到 signal 响。返回 true 表示是被 signal 打断的。 */
function raceSignal(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      resolve(true);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

describe("withCallTimeout", () => {
  it("到点了 → unavailable（可重试、退预算），不是 aborted", async () => {
    const inner = new Sleepy(1000);
    const res = await withCallTimeout(inner, 20).send(REQ);
    expect(res).toEqual({
      ok: false,
      error: { kind: "unavailable", retryAfterMs: null },
    });
  });

  it("没到点 → 原样放行", async () => {
    const res = await withCallTimeout(new Sleepy(0), 1000).send(REQ);
    expect(res).toEqual({
      ok: true,
      value: { kind: "completed", meta: NO_META, text: "答案" },
    });
  });

  it("是外面的信号先响 → 仍然是 aborted，不许改写成超时", async () => {
    const ctrl = new AbortController();
    const p = withCallTimeout(new Sleepy(1000), 5000).send(REQ, {
      signal: ctrl.signal,
    });
    ctrl.abort(new Error("client-gone"));
    expect(await p).toEqual({
      ok: false,
      error: { kind: "aborted", sideEffect: "unknown" },
    });
  });

  it("流式走同一条判据", async () => {
    const got: Result<StreamChunk, LlmError>[] = [];
    for await (const c of withCallTimeout(new Sleepy(1000), 20).stream(REQ)) {
      got.push(c);
    }
    expect(got).toEqual([
      { ok: false, error: { kind: "unavailable", retryAfterMs: null } },
    ]);
  });

  it("每次调用拿到的是不同的信号 —— 共享 controller 是熔断丝", async () => {
    const inner = new Sleepy(0);
    const llm = withCallTimeout(inner, 1000);
    await llm.send(REQ);
    await llm.send(REQ);
    expect(inner.seen).toHaveLength(2);
    expect(inner.seen[0]).not.toBe(inner.seen[1]);
  });
});
