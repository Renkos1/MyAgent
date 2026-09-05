/**
 * 脚本化的假模型 —— ★阶段 2 的验收标准就是靠它成立的★。
 *
 * 它证明的事情只有一件：用例层不认识任何真实供应商，
 * 所以可以在没有网络、没有账单、输出完全确定的情况下跑完一整轮循环。
 *
 * 用法：按顺序排好每次 send 要返回什么，跑完就报错（脚本不够长 = 用例写错了）。
 */
import type {
  CallOptions,
  LlmError,
  LlmPort,
  LlmResponse,
  LlmSession,
  StreamChunk,
  TurnInput,
} from "../../app/ports.ts";
import type { Result } from "../../domain/result.ts";
import { err, ok } from "../../domain/result.ts";

export type Scripted = Result<LlmResponse, LlmError>;

export class FakeLlm implements LlmPort {
  /** 每次 send 收到的增量，按顺序。★断言"喂回去的是什么"用它★。 */
  readonly sent: (readonly TurnInput[])[] = [];
  /** 收到的 systemPrompt，每开一次 session 记一条。 */
  readonly sessions: string[] = [];
  private next = 0;
  private readonly script: readonly Scripted[];

  // ⚠ ★不能写成参数属性 constructor(private readonly script: …)★：
  //   Node 的类型擦除是 strip-only —— 只能★删★，不能★生成★代码，
  //   而参数属性要生成一句 this.script = script。
  //   ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX，且 tsc 和 vitest 都不会报。
  constructor(script: readonly Scripted[]) {
    this.script = script;
  }

  /** 已经消费了几条脚本。 */
  get calls(): number {
    return this.next;
  }

  startSession(systemPrompt: string): LlmSession {
    this.sessions.push(systemPrompt);
    return {
      send: (delta, opts) => Promise.resolve(this.take(delta, opts)),
      stream: (delta, opts) => this.streamOf(delta, opts),
    };
  }

  private take(
    delta: readonly TurnInput[],
    opts: CallOptions | undefined,
  ): Scripted {
    if (opts?.signal?.aborted === true) return err({ kind: "aborted" });
    this.sent.push(delta);
    const item = this.script[this.next];
    if (item === undefined) {
      throw new Error(
        `FakeLlm：脚本只有 ${String(this.script.length)} 条，第 ${String(this.next + 1)} 次 send 没得给`,
      );
    }
    this.next += 1;
    return item;
  }

  private async *streamOf(
    delta: readonly TurnInput[],
    opts: CallOptions | undefined,
  ): AsyncIterable<Result<StreamChunk, LlmError>> {
    await Promise.resolve(); // 让它真的是异步的：同步 yield 会掩盖调用方的竞态
    const res = this.take(delta, opts);
    if (!res.ok) {
      yield err(res.error);
      return;
    }
    if (res.value.kind === "completed") {
      for (const ch of res.value.text) yield ok({ kind: "text", delta: ch });
    }
    yield ok({ kind: "end", response: res.value });
  }
}
