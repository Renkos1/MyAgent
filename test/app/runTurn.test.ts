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

// ══════════════════════════════════════════════════════════════
describe("runTurn 契约②：端口失败时，没花到钱的预算要退回", () => {
  // 推演：轮首 recordModelCall → modelCalls=1 → send 失败。
  // rejected = 401/400，请求没被受理，供应商没产生 token → ★退★ → 回到 0。
  it("rejected → budget 退回，modelCalls 停在 0", async () => {
    const llm = new FakeLlm([{ ok: false, error: { kind: "rejected" } }]);
    const { result } = await collect(
      run({ llm, tools: new FakeTools({}), sleep: nap }, cfgWith(), SYS, Q),
    );
    expect(result).toMatchObject({
      kind: "failed",
      error: { kind: "rejected" },
    });
    if (result.kind !== "setup") expect(result.budget.modelCalls).toBe(0);
  });

  // aborted = 我们自己叫停，模型那边已经在生成了 → ★不退★ → 停在 1。
  it("aborted → ★不退★，modelCalls 停在 1", async () => {
    const llm = new FakeLlm([{ ok: false, error: { kind: "aborted" } }]);
    const { result } = await collect(
      run({ llm, tools: new FakeTools({}), sleep: nap }, cfgWith(), SYS, Q),
    );
    expect(result).toMatchObject({
      kind: "failed",
      error: { kind: "aborted" },
    });
    if (result.kind !== "setup") expect(result.budget.modelCalls).toBe(1);
  });

  // malformed = 模型答了、只是我们读不懂 → 花了钱 → 不退。
  it("malformed → ★不退★，modelCalls 停在 1", async () => {
    const llm = new FakeLlm([{ ok: false, error: { kind: "malformed" } }]);
    const { result } = await collect(
      run({ llm, tools: new FakeTools({}), sleep: nap }, cfgWith(), SYS, Q),
    );
    if (result.kind !== "setup") expect(result.budget.modelCalls).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════
describe("runTurn 重试：只对 unavailable，最多 maxRetries 次", () => {
  // 推演：maxRetries=2 → 第 1 次 + 重试 2 次 = ★一共 send 3 次★，然后放弃。
  // 脚本给 4 条：多的那条是陷阱 —— 实现要是重试 3 次，calls 会变成 4。
  it("unavailable 一直失败 → 一共问 3 次", async () => {
    const boom = {
      ok: false as const,
      error: { kind: "unavailable" as const, retryAfterMs: null },
    };
    const llm = new FakeLlm([boom, boom, boom, boom]);
    const { result } = await collect(
      run(
        { llm, tools: new FakeTools({}), sleep: nap },
        cfgWith({ maxRetries: 2 }),
        SYS,
        Q,
      ),
    );
    expect(result.kind).toBe("failed");
    expect(llm.calls).toBe(3);
  });

  // rejected 不该重试 —— 重试没用。
  it("rejected → ★一次都不重试★，只问 1 次", async () => {
    const llm = new FakeLlm([
      { ok: false, error: { kind: "rejected" } },
      { ok: false, error: { kind: "rejected" } },
    ]);
    await collect(
      run(
        { llm, tools: new FakeTools({}), sleep: nap },
        cfgWith({ maxRetries: 2 }),
        SYS,
        Q,
      ),
    );
    expect(llm.calls).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════
describe("runTurn 契约③：工具预算在跑工具之前扣，不够★一个都不跑★", () => {
  // 推演：maxToolRuns=1，模型要 2 个工具。
  //   轮首扣模型 → modelCalls=1（额度 9，够）
  //   decide → continue{toolRuns:2}
  //   recordToolRuns(budget, 2)：0 + 2 > 1 → 失败，used=0 max=1
  // ★关键断言★：失败发生在跑工具之前，所以 tools.seen 必须是空的。
  it("额度 1 而模型要 2 个 → aborted(tool-runs)，且★一个工具都没跑★", async () => {
    const llm = new FakeLlm([
      {
        ok: true,
        value: {
          kind: "tool-requested",
          calls: [
            { name: "list_files", id: "t1", dir: "docs" },
            { name: "read_file", id: "t2", path: "docs/README.md" },
          ],
        },
      },
    ]);
    const tools = new FakeTools({
      t1: { kind: "ok", content: "a" },
      t2: { kind: "ok", content: "b" },
    });
    const { result } = await collect(
      run(
        { llm, tools, sleep: nap },
        cfgWith({
          limits: {
            maxModelCalls: 9,
            maxToolRuns: 1,
            maxInputBytesPerItem: 4096,
            maxInputBytesTotal: 65536,
          },
        }),
        SYS,
        Q,
      ),
    );
    expect(result).toMatchObject({
      kind: "aborted",
      reason: {
        kind: "insufficient-budget",
        limit: "tool-runs",
        used: 0,
        max: 1,
      },
    });
    expect(tools.seen).toEqual([]); // ★没发生什么★
  });
});

// ══════════════════════════════════════════════════════════════
describe("runTurn 契约⑤：并行有上限", () => {
  // 推演：模型一次要 4 个工具，maxConcurrentTools=2 → 同时最多 2 个在跑。
  it("4 个工具、上限 2 → 并发峰值是 2", async () => {
    const calls = [1, 2, 3, 4].map((n) => ({
      name: "read_file" as const,
      id: `t${String(n)}`,
      path: `f${String(n)}`,
    }));
    const llm = new FakeLlm([
      { ok: true, value: { kind: "tool-requested", calls } },
      { ok: true, value: { kind: "completed", text: "好了" } },
    ]);
    const tools = new FakeTools(
      Object.fromEntries(
        calls.map((c) => [c.id, { kind: "ok" as const, content: "x" }]),
      ),
    );
    const { result } = await collect(
      run(
        { llm, tools, sleep: nap },
        cfgWith({ maxConcurrentTools: 2 }),
        SYS,
        Q,
      ),
    );
    expect(result.kind).toBe("done");
    expect(tools.seen).toHaveLength(4);
    expect(tools.peakConcurrency).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════
describe("runTurn 契约⑥：用户输入 reject，工具结果 truncate", () => {
  // 推演：maxInputBytesPerItem=20。
  //   问题 "q" 1 字节，过。
  //   工具结果 60 字节 > 20 → toolResultMode="truncate" → ★截断后继续★，不是失败。
  it("工具结果超长 → 截断后循环继续，最终 done", async () => {
    const llm = new FakeLlm([
      {
        ok: true,
        value: {
          kind: "tool-requested",
          calls: [{ name: "read_file", id: "t1", path: "big" }],
        },
      },
      { ok: true, value: { kind: "completed", text: "读完了" } },
    ]);
    const tools = new FakeTools({
      t1: { kind: "ok", content: "x".repeat(60) },
    });
    const { events, result } = await collect(
      run(
        { llm, tools, sleep: nap },
        cfgWith({
          limits: {
            maxModelCalls: 9,
            maxToolRuns: 9,
            maxInputBytesPerItem: 20,
            maxInputBytesTotal: 65536,
          },
        }),
        SYS,
        Q,
      ),
    );
    expect(result.kind).toBe("done");
    expect(events.some((e) => e.kind === "input-truncated")).toBe(true);
  });

  // 反向：用户输入超长 → userInputMode="reject" → 当场失败，一次模型都不问。
  it("用户输入超长 → setup 失败，★一次都不问模型★", async () => {
    const llm = new FakeLlm([]);
    const { result } = await collect(
      run(
        { llm, tools: new FakeTools({}), sleep: nap },
        cfgWith({
          limits: {
            maxModelCalls: 9,
            maxToolRuns: 9,
            maxInputBytesPerItem: 5,
            maxInputBytesTotal: 65536,
          },
        }),
        SYS,
        "这是一个很长的问题超过五个字节",
      ),
    );
    expect(result).toMatchObject({
      kind: "setup",
      error: { kind: "item-too-large" },
    });
    expect(llm.calls).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════
describe("runTurn 契约⑦：四个顶层 kind 各自出现在该出现的地方", () => {
  it("模型直接说完 → done，text 是模型说的那句", async () => {
    const llm = new FakeLlm([
      { ok: true, value: { kind: "completed", text: "答案" } },
    ]);
    const { result } = await collect(
      run({ llm, tools: new FakeTools({}), sleep: nap }, cfgWith(), SYS, Q),
    );
    expect(result).toMatchObject({ kind: "done", text: "答案" });
  });

  it("内容不可信（truncated）→ aborted，不是 done", async () => {
    const llm = new FakeLlm([
      { ok: true, value: { kind: "truncated", partialText: "半句" } },
    ]);
    const { result } = await collect(
      run({ llm, tools: new FakeTools({}), sleep: nap }, cfgWith(), SYS, Q),
    );
    expect(result).toMatchObject({
      kind: "aborted",
      reason: { kind: "truncated" },
    });
  });

  it("上限非法 → setup，连模型都不问", async () => {
    const llm = new FakeLlm([]);
    const { result } = await collect(
      run(
        { llm, tools: new FakeTools({}), sleep: nap },
        cfgWith({
          limits: {
            maxModelCalls: 0,
            maxToolRuns: 9,
            maxInputBytesPerItem: 4096,
            maxInputBytesTotal: 65536,
          },
        }),
        SYS,
        Q,
      ),
    );
    expect(result.kind).toBe("setup");
    expect(llm.calls).toBe(0);
  });
});
