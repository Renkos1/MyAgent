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
 * 现在被取消了吗。
 *
 * @remarks
 * TRAP: 这里必须是个**函数**，不能在 run 里连写两次 `opts?.signal?.aborted === true`。
 * `AbortSignal.aborted` 是个会变的 getter，但 tsc 只把它当普通只读布尔属性：
 * 第一次比较之后它就把类型收窄成 `false | undefined`，第二次比较直接报
 * `TS2367: This comparison appears to be unintentional`。
 * IMPORTANT: **收窄在这里是不成立的** —— 中间隔着 await，signal 完全可以翻面。
 * 过一层函数调用，tsc 就不再跨调用收窄，而运行时读到的是当下的值。
 *
 * @param opts - 调用方给的选项
 * @returns 此刻 signal 是不是已经 aborted
 */
function cancelled(opts: CallOptions | undefined): boolean {
  return opts?.signal?.aborted === true;
}

/**
 * 按表返回预设结果的假工具执行器，同时量峰值并发。
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
    // IMPORTANT: 第一道检查在任何 await 和任何 push 之前 ——
    //            这一支的全部意义就是「一步都没跑」，所以它自己也不许留痕迹。
    //            ADR 0015 §②：sideEffect 说的是事实，不是意图。
    if (cancelled(opts)) return { kind: "aborted", sideEffect: "none" };

    this.running += 1;
    this.peakConcurrency = Math.max(this.peakConcurrency, this.running);
    try {
      for (let i = 0; i < this.hold; i++) await Promise.resolve();
      this.seen.push(call);
      // ADR 0014 §①：取消不是失败。IMPORTANT: 这里返回 aborted 而不是
      // failed/unknown —— 后者会让调用方把「我们叫停」记成「工具坏了」。
      //
      // 走到这里 seen 已经记上了 = 副作用确实发生过一点，而且我们不知道
      // 表里那一格代表的动作做完没有 ⇒ unknown，不是 none（ADR 0015 §①）。
      if (cancelled(opts)) return { kind: "aborted", sideEffect: "unknown" };
      return this.table[call.id] ?? { kind: "not-found" };
    } finally {
      this.running -= 1;
    }
  }
}
