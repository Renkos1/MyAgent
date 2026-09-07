/**
 * 用例层：把领域规则和端口拼成一轮 agent 循环。
 *
 * @remarks
 * IMPORTANT: 这个文件不定新规则 —— 规则全在 domain 里，它只决定**调用顺序**。
 *
 * 形态是 async generator：中间事件 yield，最终结果 return。
 * NOTE: `for await` 拿不到 return 值（那是 AsyncGenerator 的第二个类型参数），
 * 调用方要么手动 `next()` 到 done，要么用 {@link collect}。
 *
 * @see docs/decisions/0011-use-case-orchestration.md  七个决定的候选、判据、代价
 * @see docs/decisions/0005-tool-run-permit.md  为什么扣预算和跑工具的顺序由类型保证
 * @see docs/decisions/0003-validated-run-config.md  为什么 cfg 是 ValidRunConfig
 */
import type {
  InsufficientBudget,
  LoopBudget,
  ToolRunPermit,
} from "../domain/loop.ts";
import { recordModelCall, reserveToolRuns } from "../domain/loop.ts";
import { admitInput } from "../domain/input.ts";
import type { InputError } from "../domain/input.ts";
import type { ValidRunConfig } from "./config.ts";
import type { AbortReason } from "../domain/turn.ts";
import { decide } from "../domain/turn.ts";
import type {
  CallOptions,
  LlmError,
  LlmPort,
  LlmRequest,
  ToolCall,
  ToolOutcome,
  ToolPort,
  TurnInput,
} from "./ports.ts";
import { toOutcome } from "./ports.ts";

/**
 * 循环过程中吐出去的事件。
 *
 * @remarks
 * IMPORTANT: run 是 async generator，事件是它的第二种可观察输出 ——
 * 和返回值一样属于契约（选 generator 的全部理由就在这里）。
 *
 * 每一轮的顺序固定：
 * `turn-started` → `retrying`* → `tool-started`* → `tool-finished`* → `input-truncated`*
 *
 * IMPORTANT: 所有 tool-started 在任何 tool-finished 之前发完 ——
 * 工具是并发跑的，调用方不要按「一发一收」配对，要按 call.id 对账。
 */
export type RunEvent =
  | { readonly kind: "turn-started"; readonly turn: number }
  | { readonly kind: "tool-started"; readonly call: ToolCall }
  | {
      readonly kind: "tool-finished";
      readonly call: ToolCall;
      readonly outcome: ToolOutcome;
    }
  | {
      readonly kind: "retrying";
      readonly attempt: number;
      readonly afterMs: number;
    }
  | { readonly kind: "input-truncated"; readonly index: number };

/**
 * 四个顶层 kind，对齐 Decision 的形状。
 *
 * @remarks
 * IMPORTANT: aborted 是**领域拒绝**（我们的规则挡下来的），
 * failed 是**端口失败**（外界的问题）—— 调用方的处理不同，所以不能合并。
 * 三个都带 budget：阶段 8 的成本核算要它。
 */
export type RunResult =
  | {
      readonly kind: "done";
      readonly text: string;
      readonly budget: LoopBudget;
    }
  | {
      readonly kind: "aborted";
      readonly reason: AbortReason;
      readonly budget: LoopBudget;
    }
  | {
      readonly kind: "failed";
      readonly error: LlmError;
      readonly budget: LoopBudget;
    }
  | { readonly kind: "setup"; readonly error: InputError };

/**
 * run 要的三样外部东西。
 *
 * @remarks
 * 组合根（index.ts）负责装配；用例层只认这三个形状，不认任何供应商。
 */
export type Deps = {
  readonly llm: LlmPort;
  readonly tools: ToolPort;
  /** 注入的等待。NOTE: 测试里换成立即 resolve，不然重试测试要真的睡。 */
  readonly sleep: (ms: number) => Promise<void>;
};

/**
 * 这些错误没花到钱，预算退回。
 *
 * @remarks
 * 判据是供应商那边有没有产生 token，见 ADR 0011 §②。
 * TODO(阶段 4): unavailable 里混着「连接超时」和「生成到一半断线」，
 * 后者其实花了钱 —— 接真模型时要用 provider 后台的用量对账。
 */
function refundable(e: LlmError): boolean {
  return e.kind === "unavailable" || e.kind === "rejected";
}

/** 只对 unavailable 重试；retryAfterMs 有值就听它的。 */
async function* sendWithRetry(
  deps: Deps,
  cfg: ValidRunConfig,
  req: LlmRequest,
  opts: CallOptions | undefined,
): AsyncGenerator<RunEvent, Awaited<ReturnType<LlmPort["send"]>>> {
  let attempt = 0;
  for (;;) {
    const res = await deps.llm.send(req, opts);
    if (res.ok || res.error.kind !== "unavailable") return res;
    if (attempt >= cfg.maxRetries) return res;
    const afterMs = res.error.retryAfterMs ?? cfg.retryBaseMs * 2 ** attempt;
    attempt += 1;
    yield { kind: "retrying", attempt, afterMs };
    await deps.sleep(afterMs);
  }
}

/**
 * 并行但限流。
 *
 * @remarks
 * IMPORTANT: 按请求顺序返回，不按完成顺序 —— 否则日志没法对账。
 */
async function runTools(
  deps: Deps,
  cfg: ValidRunConfig,
  // IMPORTANT: 这个参数就是门禁 —— 没有许可证 = 没扣过预算 = 编译不过。
  //            它只需要"存在"，函数体不用它。
  _permit: ToolRunPermit,
  calls: readonly ToolCall[],
  opts: CallOptions | undefined,
): Promise<readonly ToolOutcome[]> {
  // NOTE: 预分配是写给读者的意图（长度 = 请求数），不是行为 —— `out[i] =`
  //       在空数组上照样把洞填出来。所以 `new Array()` 那个变异体是等价的。
  const out: ToolOutcome[] = new Array<ToolOutcome>(calls.length);
  let next = 0;
  const concurrency = Math.max(
    1,
    Math.min(cfg.maxConcurrentTools, calls.length),
  );
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      const call = calls[i];
      if (call === undefined) return;
      out[i] = await deps.tools.run(call, opts);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

/** 把工具结果变成喂回模型的文本。IMPORTANT: 截断要说出来，见 ADR 0011 §⑥。 */
function renderOutcome(outcome: ToolOutcome): string {
  switch (outcome.kind) {
    case "ok":
      return outcome.content;
    case "denied":
      return `[工具被拒绝：${outcome.reason.kind}]`;
    case "not-found":
      return "[工具失败：目标不存在]";
    case "too-large":
      return `[工具失败：${String(outcome.bytes)} 字节超过上限 ${String(outcome.max)}]`;
    case "failed":
      return `[工具失败：${outcome.cause}]`;
    // NOTE: 措辞和上面几支不同是有意的 —— 取消不是失败（ADR 0014 §①）。
    //       两格也必须说成两句：模型看到「没有执行」可以放心重来，
    //       看到「是否已执行未知」就不该假设文件没被动过（ADR 0015 §③）。
    case "aborted":
      return outcome.sideEffect === "none"
        ? "[工具已取消，没有执行]"
        : "[工具已取消，是否已执行未知]";
  }
}

/**
 * 跑完一整轮「问模型 → 跑工具 → 把结果喂回去」的循环。
 *
 * @remarks
 * 边跑边 yield {@link RunEvent}，结束时 return {@link RunResult}。
 * 循环的终止由预算保证，不由轮数：每轮开头先扣模型调用，
 * 跑工具前还要拿到许可证（同时确认「跑完之后还问得起模型」）。
 *
 * IMPORTANT: 它不抛异常。端口失败进 `failed`，我们自己的规则挡下来进
 * `aborted`，输入在进循环前就不合法进 `setup` —— 三者调用方的处理不同。
 *
 * NOTE: 这个函数里有四个变异体永远杀不掉，四个是同一回事 —— **防御性收窄**。
 * 真值都由别处的不变量保证，而类型系统证不出来，所以留着兜底：
 *
 * - `res.value.kind === "completed"` —— decide 只在 completed 那一支返回 done
 * - `res.value.kind === "tool-requested"` —— 同上，continue 只从这一支来
 * - `outcome !== undefined` —— runTools 按下标填满 out，不会留洞
 * - `call === undefined` —— 下标来自 `calls.entries()`，必在界内
 *
 * 改掉任何一个，行为都不变 ⇒ 报告里永远存活。**这是已知的，不是漏测。**
 *
 * @param deps - 注入的端口和 sleep
 * @param cfg - 已校验的配置（{@link ValidRunConfig} 只能由 createRunConfig 产出）
 * @param systemPrompt - 每次请求原样带上，不进历史
 * @param question - 用户这一次的问题，会先过 admitInput
 * @param opts - 取消信号等，透传给端口
 * @returns 事件流 + 最终的 {@link RunResult}
 * @see docs/decisions/0011-use-case-orchestration.md
 */
export async function* run(
  deps: Deps,
  cfg: ValidRunConfig,
  systemPrompt: string,
  question: string,
  opts?: CallOptions,
): AsyncGenerator<RunEvent, RunResult> {
  // NOTE: 不再有「上限非法」这条分支 —— cfg 带着校验过的 initialBudget，
  //       非法配置在 createRunConfig 那一层就被挡住了。
  const admitted = admitInput(cfg.initialBudget, [question], cfg.userInputMode);
  if (!admitted.ok) return { kind: "setup", error: admitted.error };

  let budget = admitted.value.state;
  // 历史归用例层所有，端口无状态，每次收全量（ADR 0004）。
  //
  // TRAP: 这里必须不可变地累加，不能 push。
  //       `readonly TurnInput[]` 只挡「通过这个引用改」，挡不住别名 ——
  //       把一个还会被 push 的数组交出去，接收方存下来的是引用，
  //       你后面每 push 一次，它手里那份"历史快照"就跟着变。
  //       2026-09 实测：FakeLlm.sent[0] 里出现了第 2 轮才产生的工具结果。
  let history: readonly TurnInput[] = [{ role: "user", text: question }];
  let turn = 0;

  for (;;) {
    turn += 1;
    yield { kind: "turn-started", turn };

    // send 之前扣（ADR 0011 §②）
    const before = budget;
    const charged = recordModelCall(budget);
    // NOTE: 这一支实际不可达 —— 上一轮的 reserveToolRuns 探测过 recordModelCall，
    //       所以进到下一轮时 modelCalls + 1 <= max 必然成立（ADR 0005）。
    //       留着是因为它比断言便宜：许可证的不变量哪天被改坏，这里兜得住。
    //       代价：变异测试永远杀不掉它，这是已知的，不是漏测。
    if (!charged.ok) return { kind: "aborted", reason: charged.error, budget };
    budget = charged.value;

    const res = yield* sendWithRetry(
      deps,
      cfg,
      { system: systemPrompt, history },
      opts,
    );
    if (!res.ok) {
      // 没花钱的退回
      if (refundable(res.error)) budget = before;
      return { kind: "failed", error: res.error, budget };
    }

    const decision = decide(toOutcome(res.value));
    if (decision.kind === "done") {
      const text = res.value.kind === "completed" ? res.value.text : "";
      return { kind: "done", text, budget };
    }
    if (decision.kind === "aborted") {
      return { kind: "aborted", reason: decision.reason, budget };
    }

    // 到这里 outcome 一定是 tool-requested（decide 只在那一支返回 continue）
    const calls =
      res.value.kind === "tool-requested" ? res.value.calls : ([] as const);

    // 扣工具预算 + 确认跑完还问得起模型（ADR 0005）。
    // 拿不到许可证就跑不了工具 —— 顺序由类型保证，不靠这行注释。
    const permit = reserveToolRuns(budget, decision.toolRuns);
    if (!permit.ok) {
      return {
        kind: "aborted",
        reason: permit.error as InsufficientBudget,
        budget,
      };
    }
    budget = permit.value.next;

    for (const call of calls) yield { kind: "tool-started", call };
    const outcomes = await runTools(deps, cfg, permit.value, calls, opts);

    for (const [i, call] of calls.entries()) {
      const outcome = outcomes[i];
      if (outcome !== undefined) yield { kind: "tool-finished", call, outcome };
    }

    // 工具结果走 truncate（ADR 0011 §⑥）
    const texts = outcomes.map(renderOutcome);
    const back = admitInput(budget, texts, cfg.toolResultMode);
    if (!back.ok) {
      return back.error.kind === "insufficient-budget"
        ? { kind: "aborted", reason: back.error, budget }
        : { kind: "setup", error: back.error };
    }
    budget = back.value.state;

    for (const [i, item] of back.value.items.entries()) {
      if (item.kind === "truncated")
        yield { kind: "input-truncated", index: i };
      const call = calls[i];
      if (call === undefined) continue;
      history = [
        ...history,
        {
          role: "tool-result",
          id: call.id,
          outcome:
            item.kind === "truncated"
              ? { kind: "ok", content: `${item.text}\n[已截断]` }
              : { kind: "ok", content: item.text },
        },
      ];
    }
  }
}

/**
 * 把 generator 跑到底，同时拿到事件和最终结果。
 *
 * @remarks
 * NOTE: `for await` 只吃第一个类型参数，拿不到 return 值 —— 这个助手就是为它存在的。
 */
export async function collect(
  gen: AsyncGenerator<RunEvent, RunResult>,
): Promise<{ events: RunEvent[]; result: RunResult }> {
  const events: RunEvent[] = [];
  for (;;) {
    const step = await gen.next();
    if (step.done) return { events, result: step.value };
    events.push(step.value);
  }
}
