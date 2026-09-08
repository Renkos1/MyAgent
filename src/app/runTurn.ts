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
import { err, ok } from "../domain/result.ts";
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
 * `turn-started` → (`text`* | `retrying`*) → `tool-started`* → `tool-finished`*
 * → `input-truncated`*
 *
 * IMPORTANT: 所有 tool-started 在任何 tool-finished 之前发完 ——
 * 工具是并发跑的，调用方不要按「一发一收」配对，要按 call.id 对账。
 */
export type RunEvent =
  | { readonly kind: "turn-started"; readonly turn: number }
  /**
   * 模型正在打字。
   *
   * IMPORTANT: 全部 delta 拼起来等于最终答案 —— 这条不变量归端口
   * （{@link LlmPort.stream}），用例层只是原样转发，不重排、不合并、不改。
   */
  | { readonly kind: "text"; readonly delta: string }
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

/* v8 ignore start -- 按定义不可达：能走到这里说明类型检查已经失败了 */
function assertNever(x: never): never {
  throw new Error(`runTurn.unmapped-error: ${JSON.stringify(x)}`);
}
/* v8 ignore stop */

/**
 * 这些错误没花到钱，预算退回。
 *
 * @remarks
 * 判据是供应商那边有没有产生 token，见 ADR 0011 §②。
 *
 * IMPORTANT: 写成穷尽 switch 而不是布尔表达式，是为了让 {@link LlmError}
 * 长出新 kind 时 tsc 报 TS2366（缺少 return），逼人当场答一次
 * 「这一支花钱了没有」。布尔表达式会把新 kind 静默判成 false ——
 * 那个默认值从来没人选过。
 *
 * TRAP: 2026-09 实测过代价：那时这里还是布尔表达式
 * （`e.kind === "rejected" || e.kind === "unavailable"`），给 LlmError 加一格
 * `context-exceeded`，`pnpm verify` 八道门全过、218 个用例全绿、退出码 0，零信号。
 * 对照组是同文件的 LlmResponse —— 它有 KindsMatch 顶着，tsc 当场点名两处。
 *
 * NOTE: 2026-09-08 复测，改成穷尽 switch 之后这条不再成立：同样加一格，
 * tsc 当场报 TS2366。但那句话指着函数签名，不说少了哪一格 ——
 * 下面的 assertNever 把它换成 TS2345，直接念出新 kind 的名字。两种都量过。
 * 复现：在 ports.ts 的 LlmError 末尾加一个 kind，别改别的，跑 pnpm check。
 *
 * TODO(阶段 4): unavailable 里混着「连接超时」和「生成到一半断线」，
 * 后者其实花了钱 —— 接真模型时要用 provider 后台的用量对账。
 * @see docs/decisions/0016-context-exceeded.md
 */
function refundable(e: LlmError): boolean {
  switch (e.kind) {
    // 没问到模型，或者被它在生成之前挡下
    case "unavailable":
    case "rejected":
      return true;
    // 我们自己叫停的。IMPORTANT: 判据不是「谁叫停的」，是「发出去了没有」——
    // 发之前拦下来一个 token 都没产生，发出去之后对面可能已经生成了一半。
    case "aborted":
      return e.sideEffect === "none";
    // 拿到响应了才发现读不懂 —— token 已经产生
    case "malformed":
      return false;
    default:
      return assertNever(e);
  }
}

/**
 * 走流式问一次模型，边收边把 delta 转出去；只对 unavailable 重试。
 *
 * @remarks
 * IMPORTANT: 已经吐过 delta 的那一次不重试，哪怕错误是 unavailable ——
 * 重试会从头再吐一遍，客户端屏幕上就是同一段话出现两次。
 * 要想重试又不重复，线格式得先有一个「作废前面那些」的事件，
 * 而那是对外契约的一部分（ADR 0021 D1），不是这里能顺手加的。
 *
 * NOTE: 流跑完了既没给结局也没报错，算适配器的 bug（malformed），
 * 不算成功 —— 没有结局就没有 stop_reason，判不出这一轮该做什么。
 */
async function* streamWithRetry(
  deps: Deps,
  cfg: ValidRunConfig,
  req: LlmRequest,
  opts: CallOptions | undefined,
): AsyncGenerator<RunEvent, Awaited<ReturnType<LlmPort["send"]>>> {
  let attempt = 0;
  for (;;) {
    // IMPORTANT: 量的是「推给调用方的字」，不是「收到了结局」——
    //            这一轮能不能重试全看它，名字也因此不叫 done/finished。
    let emittedText = false;
    let outcome: Awaited<ReturnType<LlmPort["send"]>> | null = null;

    for await (const chunk of deps.llm.stream(req, opts)) {
      if (!chunk.ok) {
        outcome = err(chunk.error);
        break;
      }
      if (chunk.value.kind === "text") {
        emittedText = true;
        yield { kind: "text", delta: chunk.value.delta };
        continue;
      }
      outcome = ok(chunk.value.response);
    }

    const res = outcome ?? err<LlmError>({ kind: "malformed", raw: null });
    if (res.ok || res.error.kind !== "unavailable") return res;
    if (emittedText) return res;
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

/**
 * 把工具结果变成喂回模型的文本。IMPORTANT: 截断要说出来，见 ADR 0011 §⑥。
 *
 * @remarks
 * NOTE: 这里的字符串是全项目少数**读者是模型**的字符串之一（另一处是
 * infra/anthropic 的工具描述）。它们的语言不按代码规范定，按实测定 ——
 * 判据是模型答得准不准、token 花多少，不是「哪种语言更规范」。
 *
 * TODO(阶段 4): 接上 key 之后拿 src/eval/ 跑一次对照：同一组题，
 * 工具描述和工具结果的中文版 vs 英文版，比通过率和 token 用量。
 * 在拿到那组数字之前不许凭直觉改语言。
 */
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

    const res = yield* streamWithRetry(
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

    // IMPORTANT: assistant 那一轮必须先进历史，工具结果才有东西可回应 ——
    //            供应商的线格式要求「工具结果」跟在带工具调用的 assistant 后面。
    //            ADR 0004 之后历史里只有 user / tool-result，这一格是补上的。
    // @see docs/decisions/0018-assistant-turn.md
    // opaque 只是搬运：用例层不看内容、不判断，只保证它跟着 calls 一起回去。
    // NOTE: 条件展开而不是 `opaque: x ?? undefined` —— exactOptionalPropertyTypes
    //       下「没有这个键」和「键的值是 undefined」是两种类型。
    const opaque =
      res.value.kind === "tool-requested" ? res.value.opaque : undefined;
    history = [
      ...history,
      { role: "assistant", calls, ...(opaque === undefined ? {} : { opaque }) },
    ];

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
