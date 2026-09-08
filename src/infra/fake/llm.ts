/**
 * 脚本化的假模型 —— 阶段 2 的验收标准靠它成立。
 *
 * @remarks
 * 它证明的只有一件事：用例层不认识任何真实供应商，
 * 所以能在没有网络、没有账单、输出完全确定的情况下跑完一整轮循环。
 *
 * 按顺序排好每次 send 要返回什么。IMPORTANT: 脚本长度本身就是一条断言 ——
 * 跑完就抛错，所以「最多问 N 次」不用写 expect，摆好脚本就有了。
 */
import type {
  CallOptions,
  LlmError,
  LlmPort,
  ProviderCapabilities,
  LlmRequest,
  LlmResponse,
  StreamChunk,
  TurnInput,
} from "../../app/ports.ts";
import type { Result } from "../../domain/result.ts";
import { err, ok } from "../../domain/result.ts";

/** 脚本里的一格：这一次 send 要返回成功响应还是错误。 */
export type Scripted = Result<LlmResponse, LlmError>;

/**
 * 按脚本依次返回预设响应的假模型，另外把收到的历史全存下来。
 *
 * @remarks
 * IMPORTANT: 脚本长度本身就是一条断言 —— 跑完还问就抛错，
 * 所以「最多问 N 次」不用写 expect，摆好脚本就有了。
 */
export class FakeLlm implements LlmPort {
  /**
   * 假模型的能力表。
   *
   * IMPORTANT: 全 `yes` 不是「假装什么都行」，是**事实** ——
   * 这些能力由这个类自己实现，没有第三方可以不支持。
   * `promptCaching: "none"` 同理：它一个字节都不缓存。
   *
   * NOTE: 这张表存在的意义是让契约套件能对每个实现问同一句话。
   * 拿 FakeLlm 跑通不代表真适配器能跑通 —— 差异就在这张表里。
   */
  readonly capabilities: ProviderCapabilities = {
    toolUse: "yes",
    parallelToolUse: "yes",
    streaming: "yes",
    midConversationSystem: "yes",
    promptCaching: "none",
    verifiesThinkingSignature: "no",
    validatesModelName: "yes",
  };

  /**
   * 每次请求收到的全量历史，按顺序。
   *
   * NOTE: 历史归属改到用例层之后，这里存的不再是增量。
   * 断言「第 2 次请求里带上了第 1 轮的工具结果」直接看 `sent[1]` 就行。
   */
  readonly sent: (readonly TurnInput[])[] = [];
  /** 收到的 system prompt，每次请求记一条。 */
  readonly systems: string[] = [];
  private next = 0;
  private readonly script: readonly Scripted[];

  // TRAP: 不能写成参数属性 `constructor(private readonly script: …)` ——
  //       Node 的类型擦除是 strip-only，只能删不能生成代码，
  //       而参数属性要生成一句 this.script = script。
  //       ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX，且 tsc 和 vitest 都不会报。
  constructor(script: readonly Scripted[]) {
    this.script = script;
  }

  /** 已经消费了几条脚本 = 模型被问了几次。 */
  get calls(): number {
    return this.next;
  }

  send(req: LlmRequest, opts?: CallOptions): Promise<Scripted> {
    return Promise.resolve(this.take(req, opts));
  }

  async *stream(
    req: LlmRequest,
    opts?: CallOptions,
  ): AsyncIterable<Result<StreamChunk, LlmError>> {
    await Promise.resolve(); // 让它真的是异步的：同步 yield 会掩盖调用方的竞态
    const res = this.take(req, opts);
    if (!res.ok) {
      yield err(res.error);
      return;
    }
    if (res.value.kind === "completed") {
      for (const ch of res.value.text) yield ok({ kind: "text", delta: ch });
    }
    yield ok({ kind: "end", response: res.value });
  }

  private take(req: LlmRequest, opts: CallOptions | undefined): Scripted {
    // NOTE: 进来之前就 aborted -> 一条脚本都没消费，什么都没发出去。
    if (opts?.signal?.aborted === true) {
      return err({ kind: "aborted", sideEffect: "none" });
    }
    this.sent.push(req.history);
    this.systems.push(req.system);
    const item = this.script[this.next];
    if (item === undefined) {
      // NOTE: 冒号前是稳定的英文标识（可 grep、可当断言的 key），
      //       后面的中文只是给人读的解释，改措辞不该影响任何匹配。
      throw new Error(
        `FakeLlm.script-exhausted: 脚本只有 ${String(this.script.length)} 条，` +
          `第 ${String(this.next + 1)} 次请求没得给`,
      );
    }
    this.next += 1;
    return item;
  }
}
