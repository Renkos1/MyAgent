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
// @ts-nocheck
function stryNS_9fa48() {
  var g =
    (typeof globalThis === "object" &&
      globalThis &&
      globalThis.Math === Math &&
      globalThis) ||
    new Function("return this")();
  var ns = g.__stryker__ || (g.__stryker__ = {});
  if (
    ns.activeMutant === undefined &&
    g.process &&
    g.process.env &&
    g.process.env.__STRYKER_ACTIVE_MUTANT__
  ) {
    ns.activeMutant = g.process.env.__STRYKER_ACTIVE_MUTANT__;
  }
  function retrieveNS() {
    return ns;
  }
  stryNS_9fa48 = retrieveNS;
  return retrieveNS();
}
stryNS_9fa48();
function stryCov_9fa48() {
  var ns = stryNS_9fa48();
  var cov =
    ns.mutantCoverage ||
    (ns.mutantCoverage = {
      static: {},
      perTest: {},
    });
  function cover() {
    var c = cov.static;
    if (ns.currentTestId) {
      c = cov.perTest[ns.currentTestId] = cov.perTest[ns.currentTestId] || {};
    }
    var a = arguments;
    for (var i = 0; i < a.length; i++) {
      c[a[i]] = (c[a[i]] || 0) + 1;
    }
  }
  stryCov_9fa48 = cover;
  cover.apply(null, arguments);
}
function stryMutAct_9fa48(id) {
  var ns = stryNS_9fa48();
  function isActive(id) {
    if (ns.activeMutant === id) {
      if (ns.hitCount !== void 0 && ++ns.hitCount > ns.hitLimit) {
        throw new Error(
          "Stryker: Hit count limit reached (" + ns.hitCount + ")",
        );
      }
      return true;
    }
    return false;
  }
  stryMutAct_9fa48 = isActive;
  return isActive(id);
}
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
export type RunEvent =
  | {
      readonly kind: "turn-started";
      readonly turn: number;
    }
  | {
      readonly kind: "tool-started";
      readonly call: ToolCall;
    }
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
  | {
      readonly kind: "input-truncated";
      readonly index: number;
    };

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
  | {
      readonly kind: "setup";
      readonly error: InputError;
    };
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
  if (stryMutAct_9fa48("55")) {
    {
    }
  } else {
    stryCov_9fa48("55");
    return stryMutAct_9fa48("58")
      ? e.kind === "unavailable" && e.kind === "rejected"
      : stryMutAct_9fa48("57")
        ? false
        : stryMutAct_9fa48("56")
          ? true
          : (stryCov_9fa48("56", "57", "58"),
            (stryMutAct_9fa48("60")
              ? e.kind !== "unavailable"
              : stryMutAct_9fa48("59")
                ? false
                : (stryCov_9fa48("59", "60"),
                  e.kind ===
                    (stryMutAct_9fa48("61")
                      ? ""
                      : (stryCov_9fa48("61"), "unavailable")))) ||
              (stryMutAct_9fa48("63")
                ? e.kind !== "rejected"
                : stryMutAct_9fa48("62")
                  ? false
                  : (stryCov_9fa48("62", "63"),
                    e.kind ===
                      (stryMutAct_9fa48("64")
                        ? ""
                        : (stryCov_9fa48("64"), "rejected")))));
  }
}

/** 只对 unavailable 重试；retryAfterMs 有值就听它的。 */
async function* sendWithRetry(
  deps: Deps,
  cfg: ValidRunConfig,
  req: LlmRequest,
  opts: CallOptions | undefined,
): AsyncGenerator<RunEvent, Awaited<ReturnType<LlmPort["send"]>>> {
  if (stryMutAct_9fa48("65")) {
    {
    }
  } else {
    stryCov_9fa48("65");
    let attempt = 0;
    if (stryMutAct_9fa48("66")) {
      for (; false;) {
        const res = await deps.llm.send(req, opts);
        if (res.ok || res.error.kind !== "unavailable") return res;
        if (attempt >= cfg.maxRetries) return res;
        const afterMs =
          res.error.retryAfterMs ?? cfg.retryBaseMs * 2 ** attempt;
        attempt += 1;
        yield {
          kind: "retrying",
          attempt,
          afterMs,
        };
        await deps.sleep(afterMs);
      }
    } else {
      stryCov_9fa48("66");
      for (;;) {
        if (stryMutAct_9fa48("67")) {
          {
          }
        } else {
          stryCov_9fa48("67");
          const res = await deps.llm.send(req, opts);
          if (
            stryMutAct_9fa48("70")
              ? res.ok && res.error.kind !== "unavailable"
              : stryMutAct_9fa48("69")
                ? false
                : stryMutAct_9fa48("68")
                  ? true
                  : (stryCov_9fa48("68", "69", "70"),
                    res.ok ||
                      (stryMutAct_9fa48("72")
                        ? res.error.kind === "unavailable"
                        : stryMutAct_9fa48("71")
                          ? false
                          : (stryCov_9fa48("71", "72"),
                            res.error.kind !==
                              (stryMutAct_9fa48("73")
                                ? ""
                                : (stryCov_9fa48("73"), "unavailable")))))
          )
            return res;
          if (
            stryMutAct_9fa48("77")
              ? attempt < cfg.maxRetries
              : stryMutAct_9fa48("76")
                ? attempt > cfg.maxRetries
                : stryMutAct_9fa48("75")
                  ? false
                  : stryMutAct_9fa48("74")
                    ? true
                    : (stryCov_9fa48("74", "75", "76", "77"),
                      attempt >= cfg.maxRetries)
          )
            return res;
          const afterMs = stryMutAct_9fa48("78")
            ? res.error.retryAfterMs && cfg.retryBaseMs * 2 ** attempt
            : (stryCov_9fa48("78"),
              res.error.retryAfterMs ??
                (stryMutAct_9fa48("79")
                  ? cfg.retryBaseMs / 2 ** attempt
                  : (stryCov_9fa48("79"), cfg.retryBaseMs * 2 ** attempt)));
          stryMutAct_9fa48("80")
            ? (attempt -= 1)
            : (stryCov_9fa48("80"), (attempt += 1));
          yield stryMutAct_9fa48("81")
            ? {}
            : (stryCov_9fa48("81"),
              {
                kind: stryMutAct_9fa48("82")
                  ? ""
                  : (stryCov_9fa48("82"), "retrying"),
                attempt,
                afterMs,
              });
          await deps.sleep(afterMs);
        }
      }
    }
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
  if (stryMutAct_9fa48("83")) {
    {
    }
  } else {
    stryCov_9fa48("83");
    const out: ToolOutcome[] = stryMutAct_9fa48("84")
      ? new Array()
      : (stryCov_9fa48("84"), new Array<ToolOutcome>(calls.length));
    let next = 0;
    const concurrency = stryMutAct_9fa48("85")
      ? Math.min(1, Math.min(cfg.maxConcurrentTools, calls.length))
      : (stryCov_9fa48("85"),
        Math.max(
          1,
          stryMutAct_9fa48("86")
            ? Math.max(cfg.maxConcurrentTools, calls.length)
            : (stryCov_9fa48("86"),
              Math.min(cfg.maxConcurrentTools, calls.length)),
        ));
    const worker = async (): Promise<void> => {
      if (stryMutAct_9fa48("87")) {
        {
        }
      } else {
        stryCov_9fa48("87");
        if (stryMutAct_9fa48("88")) {
          for (; false;) {
            const i = next++;
            const call = calls[i];
            if (call === undefined) return;
            out[i] = await deps.tools.run(call, opts);
          }
        } else {
          stryCov_9fa48("88");
          for (;;) {
            if (stryMutAct_9fa48("89")) {
              {
              }
            } else {
              stryCov_9fa48("89");
              const i = stryMutAct_9fa48("90")
                ? next--
                : (stryCov_9fa48("90"), next++);
              const call = calls[i];
              if (
                stryMutAct_9fa48("93")
                  ? call !== undefined
                  : stryMutAct_9fa48("92")
                    ? false
                    : stryMutAct_9fa48("91")
                      ? true
                      : (stryCov_9fa48("91", "92", "93"), call === undefined)
              )
                return;
              out[i] = await deps.tools.run(call, opts);
            }
          }
        }
      }
    };
    await Promise.all(
      Array.from(
        stryMutAct_9fa48("94")
          ? {}
          : (stryCov_9fa48("94"),
            {
              length: concurrency,
            }),
        worker,
      ),
    );
    return out;
  }
}

/** 把工具结果变成喂回模型的文本。IMPORTANT: 截断要说出来，见 ADR 0011 §⑥。 */
function renderOutcome(outcome: ToolOutcome): string {
  if (stryMutAct_9fa48("95")) {
    {
    }
  } else {
    stryCov_9fa48("95");
    switch (outcome.kind) {
      case stryMutAct_9fa48("97") ? "" : (stryCov_9fa48("97"), "ok"):
        if (stryMutAct_9fa48("96")) {
        } else {
          stryCov_9fa48("96");
          return outcome.content;
        }
      case stryMutAct_9fa48("99") ? "" : (stryCov_9fa48("99"), "denied"):
        if (stryMutAct_9fa48("98")) {
        } else {
          stryCov_9fa48("98");
          return stryMutAct_9fa48("100")
            ? ``
            : (stryCov_9fa48("100"), `[工具被拒绝：${outcome.reason.kind}]`);
        }
      case stryMutAct_9fa48("102") ? "" : (stryCov_9fa48("102"), "not-found"):
        if (stryMutAct_9fa48("101")) {
        } else {
          stryCov_9fa48("101");
          return stryMutAct_9fa48("103")
            ? ""
            : (stryCov_9fa48("103"), "[工具失败：目标不存在]");
        }
      case stryMutAct_9fa48("105") ? "" : (stryCov_9fa48("105"), "too-large"):
        if (stryMutAct_9fa48("104")) {
        } else {
          stryCov_9fa48("104");
          return stryMutAct_9fa48("106")
            ? ``
            : (stryCov_9fa48("106"),
              `[工具失败：${String(outcome.bytes)} 字节超过上限 ${String(outcome.max)}]`);
        }
      case stryMutAct_9fa48("108") ? "" : (stryCov_9fa48("108"), "failed"):
        if (stryMutAct_9fa48("107")) {
        } else {
          stryCov_9fa48("107");
          return stryMutAct_9fa48("109")
            ? ``
            : (stryCov_9fa48("109"), `[工具失败：${outcome.cause}]`);
        }
    }
  }
}
export async function* run(
  deps: Deps,
  cfg: ValidRunConfig,
  systemPrompt: string,
  question: string,
  opts?: CallOptions,
): AsyncGenerator<RunEvent, RunResult> {
  if (stryMutAct_9fa48("110")) {
    {
    }
  } else {
    stryCov_9fa48("110");
    // NOTE: 不再有「上限非法」这条分支 —— cfg 带着校验过的 initialBudget，
    //       非法配置在 createRunConfig 那一层就被挡住了。
    const admitted = admitInput(
      cfg.initialBudget,
      stryMutAct_9fa48("111") ? [] : (stryCov_9fa48("111"), [question]),
      cfg.userInputMode,
    );
    if (
      stryMutAct_9fa48("114")
        ? false
        : stryMutAct_9fa48("113")
          ? true
          : stryMutAct_9fa48("112")
            ? admitted.ok
            : (stryCov_9fa48("112", "113", "114"), !admitted.ok)
    )
      return stryMutAct_9fa48("115")
        ? {}
        : (stryCov_9fa48("115"),
          {
            kind: stryMutAct_9fa48("116")
              ? ""
              : (stryCov_9fa48("116"), "setup"),
            error: admitted.error,
          });
    let budget = admitted.value.state;
    // 历史归用例层所有，端口无状态，每次收全量（ADR 0004）。
    //
    // TRAP: 这里必须不可变地累加，不能 push。
    //       `readonly TurnInput[]` 只挡「通过这个引用改」，挡不住别名 ——
    //       把一个还会被 push 的数组交出去，接收方存下来的是引用，
    //       你后面每 push 一次，它手里那份"历史快照"就跟着变。
    //       2026-09 实测：FakeLlm.sent[0] 里出现了第 2 轮才产生的工具结果。
    let history: readonly TurnInput[] = stryMutAct_9fa48("117")
      ? []
      : (stryCov_9fa48("117"),
        [
          stryMutAct_9fa48("118")
            ? {}
            : (stryCov_9fa48("118"),
              {
                role: stryMutAct_9fa48("119")
                  ? ""
                  : (stryCov_9fa48("119"), "user"),
                text: question,
              }),
        ]);
    let turn = 0;
    if (stryMutAct_9fa48("120")) {
      for (; false;) {
        turn += 1;
        yield {
          kind: "turn-started",
          turn,
        };

        // send 之前扣（ADR 0011 §②）
        const before = budget;
        const charged = recordModelCall(budget);
        if (!charged.ok)
          return {
            kind: "aborted",
            reason: charged.error,
            budget,
          };
        budget = charged.value;
        const res = yield* sendWithRetry(
          deps,
          cfg,
          {
            system: systemPrompt,
            history,
          },
          opts,
        );
        if (!res.ok) {
          // 没花钱的退回
          if (refundable(res.error)) budget = before;
          return {
            kind: "failed",
            error: res.error,
            budget,
          };
        }
        const decision = decide(toOutcome(res.value));
        if (decision.kind === "done") {
          const text = res.value.kind === "completed" ? res.value.text : "";
          return {
            kind: "done",
            text,
            budget,
          };
        }
        if (decision.kind === "aborted") {
          return {
            kind: "aborted",
            reason: decision.reason,
            budget,
          };
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
        for (const call of calls)
          yield {
            kind: "tool-started",
            call,
          };
        const outcomes = await runTools(deps, cfg, permit.value, calls, opts);
        for (const [i, call] of calls.entries()) {
          const outcome = outcomes[i];
          if (outcome !== undefined)
            yield {
              kind: "tool-finished",
              call,
              outcome,
            };
        }

        // 工具结果走 truncate（ADR 0011 §⑥）
        const texts = outcomes.map(renderOutcome);
        const back = admitInput(budget, texts, cfg.toolResultMode);
        if (!back.ok) {
          return back.error.kind === "insufficient-budget"
            ? {
                kind: "aborted",
                reason: back.error,
                budget,
              }
            : {
                kind: "setup",
                error: back.error,
              };
        }
        budget = back.value.state;
        for (const [i, item] of back.value.items.entries()) {
          if (item.kind === "truncated")
            yield {
              kind: "input-truncated",
              index: i,
            };
          const call = calls[i];
          if (call === undefined) continue;
          history = [
            ...history,
            {
              role: "tool-result",
              id: call.id,
              outcome:
                item.kind === "truncated"
                  ? {
                      kind: "ok",
                      content: `${item.text}\n[已截断]`,
                    }
                  : {
                      kind: "ok",
                      content: item.text,
                    },
            },
          ];
        }
      }
    } else {
      stryCov_9fa48("120");
      for (;;) {
        if (stryMutAct_9fa48("121")) {
          {
          }
        } else {
          stryCov_9fa48("121");
          stryMutAct_9fa48("122")
            ? (turn -= 1)
            : (stryCov_9fa48("122"), (turn += 1));
          yield stryMutAct_9fa48("123")
            ? {}
            : (stryCov_9fa48("123"),
              {
                kind: stryMutAct_9fa48("124")
                  ? ""
                  : (stryCov_9fa48("124"), "turn-started"),
                turn,
              });

          // send 之前扣（ADR 0011 §②）
          const before = budget;
          const charged = recordModelCall(budget);
          if (
            stryMutAct_9fa48("127")
              ? false
              : stryMutAct_9fa48("126")
                ? true
                : stryMutAct_9fa48("125")
                  ? charged.ok
                  : (stryCov_9fa48("125", "126", "127"), !charged.ok)
          )
            return stryMutAct_9fa48("128")
              ? {}
              : (stryCov_9fa48("128"),
                {
                  kind: stryMutAct_9fa48("129")
                    ? ""
                    : (stryCov_9fa48("129"), "aborted"),
                  reason: charged.error,
                  budget,
                });
          budget = charged.value;
          const res = yield* sendWithRetry(
            deps,
            cfg,
            stryMutAct_9fa48("130")
              ? {}
              : (stryCov_9fa48("130"),
                {
                  system: systemPrompt,
                  history,
                }),
            opts,
          );
          if (
            stryMutAct_9fa48("133")
              ? false
              : stryMutAct_9fa48("132")
                ? true
                : stryMutAct_9fa48("131")
                  ? res.ok
                  : (stryCov_9fa48("131", "132", "133"), !res.ok)
          ) {
            if (stryMutAct_9fa48("134")) {
              {
              }
            } else {
              stryCov_9fa48("134");
              // 没花钱的退回
              if (
                stryMutAct_9fa48("136")
                  ? false
                  : stryMutAct_9fa48("135")
                    ? true
                    : (stryCov_9fa48("135", "136"), refundable(res.error))
              )
                budget = before;
              return stryMutAct_9fa48("137")
                ? {}
                : (stryCov_9fa48("137"),
                  {
                    kind: stryMutAct_9fa48("138")
                      ? ""
                      : (stryCov_9fa48("138"), "failed"),
                    error: res.error,
                    budget,
                  });
            }
          }
          const decision = decide(toOutcome(res.value));
          if (
            stryMutAct_9fa48("141")
              ? decision.kind !== "done"
              : stryMutAct_9fa48("140")
                ? false
                : stryMutAct_9fa48("139")
                  ? true
                  : (stryCov_9fa48("139", "140", "141"),
                    decision.kind ===
                      (stryMutAct_9fa48("142")
                        ? ""
                        : (stryCov_9fa48("142"), "done")))
          ) {
            if (stryMutAct_9fa48("143")) {
              {
              }
            } else {
              stryCov_9fa48("143");
              const text = (
                stryMutAct_9fa48("146")
                  ? res.value.kind !== "completed"
                  : stryMutAct_9fa48("145")
                    ? false
                    : stryMutAct_9fa48("144")
                      ? true
                      : (stryCov_9fa48("144", "145", "146"),
                        res.value.kind ===
                          (stryMutAct_9fa48("147")
                            ? ""
                            : (stryCov_9fa48("147"), "completed")))
              )
                ? res.value.text
                : stryMutAct_9fa48("148")
                  ? "Stryker was here!"
                  : (stryCov_9fa48("148"), "");
              return stryMutAct_9fa48("149")
                ? {}
                : (stryCov_9fa48("149"),
                  {
                    kind: stryMutAct_9fa48("150")
                      ? ""
                      : (stryCov_9fa48("150"), "done"),
                    text,
                    budget,
                  });
            }
          }
          if (
            stryMutAct_9fa48("153")
              ? decision.kind !== "aborted"
              : stryMutAct_9fa48("152")
                ? false
                : stryMutAct_9fa48("151")
                  ? true
                  : (stryCov_9fa48("151", "152", "153"),
                    decision.kind ===
                      (stryMutAct_9fa48("154")
                        ? ""
                        : (stryCov_9fa48("154"), "aborted")))
          ) {
            if (stryMutAct_9fa48("155")) {
              {
              }
            } else {
              stryCov_9fa48("155");
              return stryMutAct_9fa48("156")
                ? {}
                : (stryCov_9fa48("156"),
                  {
                    kind: stryMutAct_9fa48("157")
                      ? ""
                      : (stryCov_9fa48("157"), "aborted"),
                    reason: decision.reason,
                    budget,
                  });
            }
          }

          // 到这里 outcome 一定是 tool-requested（decide 只在那一支返回 continue）
          const calls = (
            stryMutAct_9fa48("160")
              ? res.value.kind !== "tool-requested"
              : stryMutAct_9fa48("159")
                ? false
                : stryMutAct_9fa48("158")
                  ? true
                  : (stryCov_9fa48("158", "159", "160"),
                    res.value.kind ===
                      (stryMutAct_9fa48("161")
                        ? ""
                        : (stryCov_9fa48("161"), "tool-requested")))
          )
            ? res.value.calls
            : ([] as const);

          // 扣工具预算 + 确认跑完还问得起模型（ADR 0005）。
          // 拿不到许可证就跑不了工具 —— 顺序由类型保证，不靠这行注释。
          const permit = reserveToolRuns(budget, decision.toolRuns);
          if (
            stryMutAct_9fa48("164")
              ? false
              : stryMutAct_9fa48("163")
                ? true
                : stryMutAct_9fa48("162")
                  ? permit.ok
                  : (stryCov_9fa48("162", "163", "164"), !permit.ok)
          ) {
            if (stryMutAct_9fa48("165")) {
              {
              }
            } else {
              stryCov_9fa48("165");
              return stryMutAct_9fa48("166")
                ? {}
                : (stryCov_9fa48("166"),
                  {
                    kind: stryMutAct_9fa48("167")
                      ? ""
                      : (stryCov_9fa48("167"), "aborted"),
                    reason: permit.error as InsufficientBudget,
                    budget,
                  });
            }
          }
          budget = permit.value.next;
          for (const call of calls)
            yield stryMutAct_9fa48("168")
              ? {}
              : (stryCov_9fa48("168"),
                {
                  kind: stryMutAct_9fa48("169")
                    ? ""
                    : (stryCov_9fa48("169"), "tool-started"),
                  call,
                });
          const outcomes = await runTools(deps, cfg, permit.value, calls, opts);
          for (const [i, call] of calls.entries()) {
            if (stryMutAct_9fa48("170")) {
              {
              }
            } else {
              stryCov_9fa48("170");
              const outcome = outcomes[i];
              if (
                stryMutAct_9fa48("173")
                  ? outcome === undefined
                  : stryMutAct_9fa48("172")
                    ? false
                    : stryMutAct_9fa48("171")
                      ? true
                      : (stryCov_9fa48("171", "172", "173"),
                        outcome !== undefined)
              )
                yield stryMutAct_9fa48("174")
                  ? {}
                  : (stryCov_9fa48("174"),
                    {
                      kind: stryMutAct_9fa48("175")
                        ? ""
                        : (stryCov_9fa48("175"), "tool-finished"),
                      call,
                      outcome,
                    });
            }
          }

          // 工具结果走 truncate（ADR 0011 §⑥）
          const texts = outcomes.map(renderOutcome);
          const back = admitInput(budget, texts, cfg.toolResultMode);
          if (
            stryMutAct_9fa48("178")
              ? false
              : stryMutAct_9fa48("177")
                ? true
                : stryMutAct_9fa48("176")
                  ? back.ok
                  : (stryCov_9fa48("176", "177", "178"), !back.ok)
          ) {
            if (stryMutAct_9fa48("179")) {
              {
              }
            } else {
              stryCov_9fa48("179");
              return (
                stryMutAct_9fa48("182")
                  ? back.error.kind !== "insufficient-budget"
                  : stryMutAct_9fa48("181")
                    ? false
                    : stryMutAct_9fa48("180")
                      ? true
                      : (stryCov_9fa48("180", "181", "182"),
                        back.error.kind ===
                          (stryMutAct_9fa48("183")
                            ? ""
                            : (stryCov_9fa48("183"), "insufficient-budget")))
              )
                ? stryMutAct_9fa48("184")
                  ? {}
                  : (stryCov_9fa48("184"),
                    {
                      kind: stryMutAct_9fa48("185")
                        ? ""
                        : (stryCov_9fa48("185"), "aborted"),
                      reason: back.error,
                      budget,
                    })
                : stryMutAct_9fa48("186")
                  ? {}
                  : (stryCov_9fa48("186"),
                    {
                      kind: stryMutAct_9fa48("187")
                        ? ""
                        : (stryCov_9fa48("187"), "setup"),
                      error: back.error,
                    });
            }
          }
          budget = back.value.state;
          for (const [i, item] of back.value.items.entries()) {
            if (stryMutAct_9fa48("188")) {
              {
              }
            } else {
              stryCov_9fa48("188");
              if (
                stryMutAct_9fa48("191")
                  ? item.kind !== "truncated"
                  : stryMutAct_9fa48("190")
                    ? false
                    : stryMutAct_9fa48("189")
                      ? true
                      : (stryCov_9fa48("189", "190", "191"),
                        item.kind ===
                          (stryMutAct_9fa48("192")
                            ? ""
                            : (stryCov_9fa48("192"), "truncated")))
              )
                yield stryMutAct_9fa48("193")
                  ? {}
                  : (stryCov_9fa48("193"),
                    {
                      kind: stryMutAct_9fa48("194")
                        ? ""
                        : (stryCov_9fa48("194"), "input-truncated"),
                      index: i,
                    });
              const call = calls[i];
              if (
                stryMutAct_9fa48("197")
                  ? call !== undefined
                  : stryMutAct_9fa48("196")
                    ? false
                    : stryMutAct_9fa48("195")
                      ? true
                      : (stryCov_9fa48("195", "196", "197"), call === undefined)
              )
                continue;
              history = stryMutAct_9fa48("198")
                ? []
                : (stryCov_9fa48("198"),
                  [
                    ...history,
                    stryMutAct_9fa48("199")
                      ? {}
                      : (stryCov_9fa48("199"),
                        {
                          role: stryMutAct_9fa48("200")
                            ? ""
                            : (stryCov_9fa48("200"), "tool-result"),
                          id: call.id,
                          outcome: (
                            stryMutAct_9fa48("203")
                              ? item.kind !== "truncated"
                              : stryMutAct_9fa48("202")
                                ? false
                                : stryMutAct_9fa48("201")
                                  ? true
                                  : (stryCov_9fa48("201", "202", "203"),
                                    item.kind ===
                                      (stryMutAct_9fa48("204")
                                        ? ""
                                        : (stryCov_9fa48("204"), "truncated")))
                          )
                            ? stryMutAct_9fa48("205")
                              ? {}
                              : (stryCov_9fa48("205"),
                                {
                                  kind: stryMutAct_9fa48("206")
                                    ? ""
                                    : (stryCov_9fa48("206"), "ok"),
                                  content: stryMutAct_9fa48("207")
                                    ? ``
                                    : (stryCov_9fa48("207"),
                                      `${item.text}\n[已截断]`),
                                })
                            : stryMutAct_9fa48("208")
                              ? {}
                              : (stryCov_9fa48("208"),
                                {
                                  kind: stryMutAct_9fa48("209")
                                    ? ""
                                    : (stryCov_9fa48("209"), "ok"),
                                  content: item.text,
                                }),
                        }),
                  ]);
            }
          }
        }
      }
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
): Promise<{
  events: RunEvent[];
  result: RunResult;
}> {
  if (stryMutAct_9fa48("210")) {
    {
    }
  } else {
    stryCov_9fa48("210");
    const events: RunEvent[] = stryMutAct_9fa48("211")
      ? ["Stryker was here"]
      : (stryCov_9fa48("211"), []);
    if (stryMutAct_9fa48("212")) {
      for (; false;) {
        const step = await gen.next();
        if (step.done)
          return {
            events,
            result: step.value,
          };
        events.push(step.value);
      }
    } else {
      stryCov_9fa48("212");
      for (;;) {
        if (stryMutAct_9fa48("213")) {
          {
          }
        } else {
          stryCov_9fa48("213");
          const step = await gen.next();
          if (
            stryMutAct_9fa48("215")
              ? false
              : stryMutAct_9fa48("214")
                ? true
                : (stryCov_9fa48("214", "215"), step.done)
          )
            return stryMutAct_9fa48("216")
              ? {}
              : (stryCov_9fa48("216"),
                {
                  events,
                  result: step.value,
                });
          if (stryMutAct_9fa48("217")) {
          } else {
            stryCov_9fa48("217");
            events.push(step.value);
          }
        }
      }
    }
  }
}
