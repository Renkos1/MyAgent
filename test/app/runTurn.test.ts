import { describe, expect, it } from "vitest";

import { collect, run } from "../../src/app/runTurn.ts";
import type { RunConfig } from "../../src/app/runTurn.ts";
import { FakeLlm } from "../../src/infra/fake/llm.ts";
import { FakeTools } from "../../src/infra/fake/tools.ts";

const SYS = "你是仓库助手。";
const Q = "docs 下有什么？";
const nap = (): Promise<void> => Promise.resolve();

/** 基线配置。★每个用例只改自己要考的那一两项★，其余保持宽松。 */
function cfgWith(over: Partial<RunConfig> = {}): RunConfig {
  return {
    limits: {
      maxModelCalls: 9,
      maxToolRuns: 9,
      maxInputBytesPerItem: 4096,
      maxInputBytesTotal: 65536,
    },
    maxConcurrentTools: 2,
    maxRetries: 2,
    retryBaseMs: 1,
    userInputMode: "reject",
    toolResultMode: "truncate",
    ...over,
  };
}

describe("runTurn 契约④：两个预算都不够时，报 model-calls", () => {
  it("模型额度 1、工具额度 1，第一轮就都用满 → 第二轮报 model-calls", async () => {
    // 排：模型第一轮要 1 个工具（把工具额度用满），第二轮它还想说话 ——
    //     但那时模型额度已经在第一轮用光了，★根本轮不到第二次 send★。
    const llm = new FakeLlm([
      {
        ok: true,
        value: {
          kind: "tool-requested",
          calls: [{ name: "list_files", id: "t1", dir: "docs" }],
        },
      },
      // ★脚本故意只给一条★：实现要是真的发了第二次 send，这里会抛"脚本不够"
    ]);
    const tools = new FakeTools({ t1: { kind: "ok", content: "README.md" } });

    // 跑
    const { result } = await collect(
      run(
        { llm, tools, sleep: nap },
        cfgWith({
          limits: {
            maxModelCalls: 1,
            maxToolRuns: 1,
            maxInputBytesPerItem: 4096,
            maxInputBytesTotal: 65536,
          },
        }),
        SYS,
        Q,
      ),
    );

    // 断：① 返回了什么 —— 报的是 model-calls，不是 tool-runs
    expect(result).toMatchObject({
      kind: "aborted",
      reason: {
        kind: "insufficient-budget",
        limit: "model-calls",
        used: 1,
        max: 1,
      },
    });
    // 断：③ 没发生什么 —— 第二次 send 没发出去
    expect(llm.calls).toBe(1);
  });
});
