/**
 * 假工具执行器。IMPORTANT: 除了返回预设结果，它还量并发 ——
 * 「并发上限有没有生效」是一条用别的办法测不出来的规则。
 */
import type {
  CallOptions,
  ToolCall,
  ToolOutcome,
  ToolPort,
} from "../../app/ports.ts";

/**
 * 按表返回预设结果的假工具执行器，同时★量峰值并发★。
 *
 * @remarks
 * 「并发上限有没有生效」用别的办法测不出来 —— 返回值里看不到它。
 */
export class FakeTools implements ToolPort {
  readonly seen: ToolCall[] = [];
  /** 同时在跑的最大个数。用来验 maxConcurrentTools。 */
  peakConcurrency = 0;
  private running = 0;

  private readonly table: Readonly<Record<string, ToolOutcome>>;
  private readonly hold: number;

  /**
   * 摆好结果表。
   *
   * @param table - 按 call.id 给结果；查不到就返回 not-found
   * @param hold - 每次 run 至少挂起几个微任务轮次。IMPORTANT: 不挂起就量不到并发
   */
  // TRAP: 不能写成参数属性 —— 参数属性在 strip-only 下跑不起来。见 llm.ts 的注释。
  constructor(table: Readonly<Record<string, ToolOutcome>>, hold = 3) {
    this.table = table;
    this.hold = hold;
  }

  async run(call: ToolCall, opts?: CallOptions): Promise<ToolOutcome> {
    this.running += 1;
    this.peakConcurrency = Math.max(this.peakConcurrency, this.running);
    try {
      for (let i = 0; i < this.hold; i++) await Promise.resolve();
      this.seen.push(call);
      if (opts?.signal?.aborted === true)
        return { kind: "failed", cause: "unknown" };
      return this.table[call.id] ?? { kind: "not-found" };
    } finally {
      this.running -= 1;
    }
  }
}
