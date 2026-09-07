/**
 * 契约套件的第二个被测实现：**真适配器 + 录音带**。
 *
 * @remarks
 * 这是阶段 4 验收标准「同一组契约测试对每个 provider 跑一遍」的落地。
 * 被测的是 `createAnthropicLlm` 的**真代码**（toMessages / toResponse /
 * toError / stream 全都在跑），只有最外面那一层 fetch 被换成了录音带。
 *
 * ```text
 * 换掉的     网络
 * 没换的     适配器的全部逻辑 —— 接缝定在 HTTP 上就是为了这个（ADR 0012 §①）
 * ```
 *
 * IMPORTANT: 用 `replayingByFingerprint` 而不是 `replaying` ——
 * 契约套件对同一个场景要连问两次、并发问三次、再单独走一遍 stream，
 * 这些请求之间没有先后关系。按顺序取会假红。
 *
 * 带子怎么来的、为什么只有 5 盘：`pnpm record` + `test/contract/tapePlan.ts`。
 */
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import type { LlmRequest } from "../../src/app/ports.ts";
import { createAnthropicLlm } from "../../src/infra/anthropic/llm.ts";
import { DEEPSEEK_COMPAT } from "../../src/infra/anthropic/providers.ts";
import { loadCassette } from "../../src/infra/tape/cassette.ts";
import {
  replayingByFingerprint,
  widenForSdk,
} from "../../src/infra/tape/http.ts";
import { llmPortContract } from "../contract/llmPort.contract.ts";
import type { ScenarioName } from "../contract/scenarios.ts";
import { SCENARIO_LIST } from "../contract/scenarios.ts";
import { TAPE_PLAN, TAPE_SYSTEM } from "../contract/tapePlan.ts";

const DIR = "test/cassettes";
const PROVIDER = "deepseek-compat";
const MODEL = "deepseek-v4-flash";

const takeOf = (name: ScenarioName): (typeof TAPE_PLAN)[number] | undefined =>
  TAPE_PLAN.find((t) => t.name === name);

/**
 * 录不到的场景 —— 能力矩阵里的空格，每一格都有理由。
 *
 * NOTE: 这不是「以后补上」的清单，是**这个装置的边界**：
 * 429/5xx 要压测、网络中断要拔网线、refusal 和未知 stop_reason 要模型配合、
 * 取消类根本不产生 HTTP 往返（`aborted-before-send` 例外，见下）。
 */
const CANNOT: readonly ScenarioName[] = SCENARIO_LIST.map((s) => s.name).filter(
  (n) => takeOf(n) === undefined && n !== "aborted-before-send",
);

llmPortContract({
  name: "AnthropicLlm + 录音带（deepseek-compat）",
  cannotStage: CANNOT,
  // 录制和回放必须发一模一样的请求，所以两边都读 TAPE_PLAN
  reqFor: (s): LlmRequest => ({
    system: TAPE_SYSTEM,
    history: [{ role: "user", text: takeOf(s.name)?.ask ?? "（用不到）" }],
  }),
  stage: (s) => {
    const take = takeOf(s.name);

    // aborted-before-send 一次 HTTP 都不发：signal 在进 fetch 之前就拦住了。
    // IMPORTANT: 所以它不需要带子 —— 给一个空带子正好证明这一点，
    //            真发了请求的话回放会当场红（带子里没有这个请求）。
    if (take === undefined) {
      if (s.name !== "aborted-before-send") return null;
      return createAnthropicLlm({
        client: new Anthropic({
          baseURL: "https://example.invalid",
          authToken: "unused",
          maxRetries: 0,
          fetch: widenForSdk(
            replayingByFingerprint({
              name: s.name,
              provider: PROVIDER,
              recordedAt: "n/a",
              apiVersion: MODEL,
              exchanges: [],
            }),
          ),
        }),
        model: MODEL,
        maxTokens: 64,
        capabilities: DEEPSEEK_COMPAT,
      });
    }

    return createAnthropicLlm({
      client: new Anthropic({
        baseURL: "https://api.deepseek.com/anthropic",
        authToken: "unused",
        maxRetries: 0,
        fetch: widenForSdk(
          replayingByFingerprint(loadCassette(DIR, PROVIDER, s.name)),
        ),
      }),
      model: MODEL,
      maxTokens: take.maxTokens,
      capabilities: DEEPSEEK_COMPAT,
    });
  },
});

// ── 装置本身的两条自检 ────────────────────────────────────────────
// IMPORTANT: 上面那一整套断言，只要带子读错了就会集体失去意义 ——
//            所以装置要自己有一条会红的信号（tooling/07 的那条规矩）。
describe("录音带装置自检", () => {
  it("缺带子是当场红，不是自动补录", () => {
    expect(() => loadCassette(DIR, PROVIDER, "server-error")).toThrow(
      /cassette\.not-found/,
    );
  });

  it("请求对不上时给出两边的指纹，不是含糊地说一句失败", async () => {
    const fetchLike = replayingByFingerprint(
      loadCassette(DIR, PROVIDER, "completed"),
    );
    await expect(
      fetchLike("https://api.deepseek.com/anthropic/v1/messages", {
        method: "POST",
        body: '{"model":"别的东西"}',
      }),
    ).rejects.toThrow(/现在发的：/);
  });
});
