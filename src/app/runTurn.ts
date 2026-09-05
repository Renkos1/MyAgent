/**
 * 用例层：把领域规则和端口拼成一轮 agent 循环。
 *
 * ★这个文件是阶段 2 的产物，也是阶段 2 唯一的产物。★
 * 它不定新规则 —— 规则全在 domain 里；它只决定★调用顺序★。
 *
 * ── 契约 ────────────────────────────────────────────────────────
 *
 * ① 函数的形状？
 *      ★async generator★：中间事件 yield，最终结果 return。
 *      理由：阶段 6 的 SSE、阶段 8 的成本日志、阶段 3 的「第 2 轮调了什么」
 *            要的都是同一样东西 —— ★看得见中间过程★。
 *      ⚠ ★for await 拿不到 return 值★（那是 AsyncGenerator 的第二个类型参数）。
 *        调用方要么手动 next() 直到 done，要么用下面的 collect 助手。
 *      代价：提前 break 会触发 generator 的 return()，清理要写在 finally 里。
 *
 * ② 模型预算什么时候扣？
 *      ★send 之前扣，端口失败且「没花钱」时退回★。
 *      哪些算没花钱 —— 判据是★供应商那边有没有产生 token★：
 *        rejected   401/400，请求没被受理           → ★退★
 *        unavailable 429/503/连不上，没进到生成      → ★退★
 *        aborted    我们自己叫停，模型已经在生成了   → 不退
 *        malformed  模型答了，只是我们读不懂         → 不退
 *      ⚠ unavailable 里混着「连接超时」和「生成到一半断线」，
 *        后者其实花了钱。★阶段 4 接真模型时要用 provider 后台的用量对账。★
 *
 * ③ 工具预算什么时候扣？
 *      decide 返回 continue 之后，★跑工具之前★。原子性由 recordToolRuns 保证。
 *
 * ④ ★两个预算都不够时报哪个？—— 这条和阶段 1 的答案相反，是被②改的。★
 *      阶段 1 的 turn.ts 契约③写的是「近的先查」：工具预算先于模型预算。
 *      但②要求模型预算在★每轮开头★扣（send 之前），
 *      而工具预算只能在 decide 说 continue 之后扣 ——
 *      ★顺序被时间轴钉死了，选不了。★
 *      现在的语义：模型额度先耗尽 → 报 model-calls，连问都问不起。
 *      判据仍是原来那条「哪个描述了用户实际拿到的东西」：
 *      问都没问出去，说「工具跑不完」是错的。
 *      ⚠ ★这条推翻了 turn.test.ts 里「两个额度都不够 → 报 tool-runs」那条断言。★
 *
 * ⑤ 工具怎么跑？
 *      ★并行，但有并发上限 maxConcurrentTools。★
 *      一批里有失败不影响其他 —— 工具失败是数据（ports 契约⑨），不是异常。
 *      ⚠ 事件顺序按★请求顺序★发，不按完成顺序，否则日志没法对账。
 *
 * ⑥ 工具结果怎么进上下文？
 *      ★过 admitInput，且和用户输入用不同的 mode★：
 *        用户输入   reject   —— 你自己打的字太长，该当场告诉你
 *        工具结果   truncate —— 文件就是大，截断喂进去好过整轮失败
 *      ⚠ 截断这件事★要告诉模型★，否则它会拿半个文件当全部来回答。
 *
 * ⑦ 返回什么？
 *      ★三个顶层 kind★，对齐 Decision 的形状：
 *        done     模型答完了
 *        aborted  ★领域拒绝★（预算 / 内容不可信）—— 我们的规则挡下来的
 *        failed   ★端口失败★（问不到模型）—— 外界的问题
 *      三个都带 budget：阶段 8 的成本核算要它。
 */
import type {
  InsufficientBudget,
  LoopBudget,
  LoopLimits,
} from "../domain/loop.ts";
import { createLoopBudget, recordModelCall, recordToolRuns } from "../domain/loop.ts";
import { admitInput } from "../domain/input.ts";
import type { InputError, LimitMode } from "../domain/input.ts";
import type { InvalidLimit } from "../domain/loop.ts";
import type { AbortReason } from "../domain/turn.ts";
import { decide } from "../domain/turn.ts";
import type {
  CallOptions,
  LlmError,
  LlmPort,
  LlmSession,
  ToolCall,
  ToolOutcome,
  ToolPort,
  TurnInput,
} from "./ports.ts";
import { toOutcome } from "./ports.ts";

export type RunConfig = {
  readonly limits: LoopLimits;
  /** 契约⑤。★这个数值是人定的★，不是我猜的默认值。 */
  readonly maxConcurrentTools: number;
  /** 契约：只对 unavailable 重试。★次数和基数是人定的★。 */
  readonly maxRetries: number;
  readonly retryBaseMs: number;
  /** 契约⑥：两个 mode 故意不同。 */
  readonly userInputMode: LimitMode;
  readonly toolResultMode: LimitMode;
};

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

/** 契约⑦：三个顶层 kind。setup 是连预算都没建起来 —— 配置写错了。 */
export type RunResult =
  | { readonly kind: "done"; readonly text: string; readonly budget: LoopBudget }
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
  | { readonly kind: "setup"; readonly error: InvalidLimit | InputError };

export type Deps = {
  readonly llm: LlmPort;
  readonly tools: ToolPort;
  /** 注入的等待。★测试里换成立即 resolve★，不然重试测试要真的睡。 */
  readonly sleep: (ms: number) => Promise<void>;
};

/** 契约②：这些错误没花到钱，预算退回。 */
function refundable(e: LlmError): boolean {
  return e.kind === "rejected" || e.kind === "unavailable";
}

/** 契约：只对 unavailable 重试；retryAfterMs 有值就听它的。 */
async function* sendWithRetry(
  deps: Deps,
  cfg: RunConfig,
  session: LlmSession,
  delta: Parameters<LlmSession["send"]>[0],
  opts: CallOptions | undefined,
): AsyncGenerator<RunEvent, Awaited<ReturnType<LlmSession["send"]>>> {
  let attempt = 0;
  for (;;) {
    const res = await session.send(delta, opts);
    if (res.ok || res.error.kind !== "unavailable") return res;
    if (attempt >= cfg.maxRetries) return res;
    const afterMs = res.error.retryAfterMs ?? cfg.retryBaseMs * 2 ** attempt;
    attempt += 1;
    yield { kind: "retrying", attempt, afterMs };
    await deps.sleep(afterMs);
  }
}

/** 契约⑤：并行但限流。★按请求顺序返回★，不按完成顺序。 */
async function runTools(
  deps: Deps,
  cfg: RunConfig,
  calls: readonly ToolCall[],
  opts: CallOptions | undefined,
): Promise<readonly ToolOutcome[]> {
  const out: ToolOutcome[] = new Array<ToolOutcome>(calls.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      const call = calls[i];
      if (call === undefined) return;
      out[i] = await deps.tools.run(call, opts);
    }
  };
  const width = Math.min(cfg.maxConcurrentTools, calls.length);
  await Promise.all(Array.from({ length: width }, worker));
  return out;
}

/** 契约⑥：把工具结果变成喂回模型的文本。截断要说出来。 */
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
  }
}

export async function* run(
  deps: Deps,
  cfg: RunConfig,
  systemPrompt: string,
  question: string,
  opts?: CallOptions,
): AsyncGenerator<RunEvent, RunResult> {
  const created = createLoopBudget(cfg.limits);
  if (!created.ok) return { kind: "setup", error: created.error };

  // 契约⑥：用户输入走 reject
  const admitted = admitInput(created.value, [question], cfg.userInputMode);
  if (!admitted.ok) return { kind: "setup", error: admitted.error };

  let budget = admitted.value.state;
  const session = deps.llm.startSession(systemPrompt);
  let delta: Parameters<LlmSession["send"]>[0] = [
    { role: "user", text: question },
  ];
  let turn = 0;

  for (;;) {
    turn += 1;
    yield { kind: "turn-started", turn };

    // 契约②：send 之前扣
    const before = budget;
    const charged = recordModelCall(budget);
    if (!charged.ok) return { kind: "aborted", reason: charged.error, budget };
    budget = charged.value;

    const res = yield* sendWithRetry(deps, cfg, session, delta, opts);
    if (!res.ok) {
      // 契约②：没花钱的退回
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

    // 契约③：跑工具之前扣工具预算，不够一个都不跑
    const spent = recordToolRuns(budget, decision.toolRuns);
    if (!spent.ok) {
      return { kind: "aborted", reason: spent.error as InsufficientBudget, budget };
    }
    budget = spent.value;

    for (const call of calls) yield { kind: "tool-started", call };
    const outcomes = await runTools(deps, cfg, calls, opts);
    for (const [i, call] of calls.entries()) {
      const outcome = outcomes[i];
      if (outcome !== undefined) yield { kind: "tool-finished", call, outcome };
    }

    // 契约⑥：工具结果走 truncate
    const texts = outcomes.map(renderOutcome);
    const back = admitInput(budget, texts, cfg.toolResultMode);
    if (!back.ok) {
      return back.error.kind === "insufficient-budget"
        ? { kind: "aborted", reason: back.error, budget }
        : { kind: "setup", error: back.error };
    }
    budget = back.value.state;

    const nextDelta: TurnInput[] = [];
    for (const [i, item] of back.value.items.entries()) {
      if (item.kind === "truncated") yield { kind: "input-truncated", index: i };
      const call = calls[i];
      if (call === undefined) continue;
      nextDelta.push({
        role: "tool-result",
        id: call.id,
        outcome:
          item.kind === "truncated"
            ? { kind: "ok", content: `${item.text}\n[已截断]` }
            : { kind: "ok", content: item.text },
      });
    }
    delta = nextDelta;
  }
}

/** 契约①的配套：for await 拿不到 return 值，所以给一个收集助手。 */
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
