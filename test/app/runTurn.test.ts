import { describe, expect, it } from "vitest";

import { collect, run } from "../../src/app/runTurn.ts";
import type { RunConfig, ValidRunConfig } from "../../src/app/config.ts";
import { createRunConfig } from "../../src/app/config.ts";
import { FakeLlm } from "../../src/infra/fake/llm.ts";
import { FakeTools } from "../../src/infra/fake/tools.ts";
import type { ToolOutcome } from "../../src/app/ports.ts";

const SYS = "你是仓库助手。";
const Q = "docs 下有什么？";
const nap = (): Promise<void> => Promise.resolve();

/** 基线配置。每个用例只改自己要考的那一两项，其余保持宽松。 */
function cfgWith(over: Partial<RunConfig> = {}): ValidRunConfig {
  const built = createRunConfig(raw(over));
  // NOTE: 脚手架自己的前置条件 —— 用例参数写错了要当场炸，不要悄悄跑下去
  if (!built.ok) throw new Error(`脚手架：配置非法 ${built.error.kind}`);
  return built.value;
}

function raw(over: Partial<RunConfig> = {}): RunConfig {
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

// @see docs/decisions/0011-use-case-orchestration.md §④ —— 两个预算都不够时报哪个
describe("预算：两个都不够时，报 model-calls", () => {
  it("模型额度 1、工具额度 1，第一轮就都用满 → 第二轮报 model-calls", async () => {
    // 排：模型第一轮要 1 个工具（把工具额度用满），第二轮它还想说话 ——
    //     但那时模型额度已经在第一轮用光了，根本轮不到第二次 send。
    const llm = new FakeLlm([
      {
        ok: true,
        value: {
          kind: "tool-requested",
          calls: [{ name: "list_files", id: "t1", dir: "docs" }],
        },
      },
      // IMPORTANT: 脚本故意只给一条 —— 实现要是真发了第二次 send，这里会抛"脚本不够"
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
// @see docs/decisions/0011-use-case-orchestration.md §② —— 模型预算什么时候扣、什么时候退
describe("预算：端口失败时，没花到钱的要退回", () => {
  // 推演：轮首 recordModelCall → modelCalls=1 → send 失败。
  // rejected = 401/400，请求没被受理，供应商没产生 token → 退 → 回到 0。
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

  // aborted = 我们自己叫停，模型那边已经在生成了 → 不退 → 停在 1。
  it("aborted → 不退，modelCalls 停在 1", async () => {
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
  it("malformed → 不退，modelCalls 停在 1", async () => {
    const llm = new FakeLlm([{ ok: false, error: { kind: "malformed" } }]);
    const { result } = await collect(
      run({ llm, tools: new FakeTools({}), sleep: nap }, cfgWith(), SYS, Q),
    );
    if (result.kind !== "setup") expect(result.budget.modelCalls).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════
describe("runTurn 重试：只对 unavailable，最多 maxRetries 次", () => {
  // 推演：maxRetries=2 → 第 1 次 + 重试 2 次 = 一共 send 3 次，然后放弃。
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
  it("rejected → 一次都不重试，只问 1 次", async () => {
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
// @see docs/decisions/0011-use-case-orchestration.md §③ —— 工具预算什么时候扣
describe("预算：工具预算在跑工具之前扣，不够就一个都不跑", () => {
  // 推演：maxToolRuns=1，模型要 2 个工具。
  //   轮首扣模型 → modelCalls=1（额度 9，够）
  //   decide → continue{toolRuns:2}
  //   recordToolRuns(budget, 2)：0 + 2 > 1 → 失败，used=0 max=1
  // IMPORTANT: 失败发生在跑工具之前，所以 tools.seen 必须是空的。
  it("额度 1 而模型要 2 个 → aborted(tool-runs)，且一个工具都没跑", async () => {
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
    expect(tools.seen).toEqual([]); // 断言③：没发生什么
  });
});

// ══════════════════════════════════════════════════════════════
// @see docs/decisions/0011-use-case-orchestration.md §⑤ —— 工具怎么跑
describe("工具：并行有上限", () => {
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
// @see docs/decisions/0011-use-case-orchestration.md §⑥ —— 工具结果怎么进上下文
describe("输入：用户输入 reject，工具结果 truncate", () => {
  // 推演：maxInputBytesPerItem=20。
  //   问题 "q" 1 字节，过。
  //   工具结果 60 字节 > 20 → toolResultMode="truncate" → 截断后继续，不是失败。
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
  it("用户输入超长 → setup 失败，一次都不问模型", async () => {
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
// @see docs/decisions/0011-use-case-orchestration.md §⑦ —— 返回什么
describe("返回：四个顶层 kind 各自出现在该出现的地方", () => {
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

  it("用户输入超长 → setup（现在 setup 只剩这一种来源）", async () => {
    const llm = new FakeLlm([]);
    const { result } = await collect(
      run(
        { llm, tools: new FakeTools({}), sleep: nap },
        cfgWith({
          limits: {
            maxModelCalls: 9,
            maxToolRuns: 9,
            maxInputBytesPerItem: 3,
            maxInputBytesTotal: 65536,
          },
        }),
        SYS,
        "超过三个字节",
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
// NOTE: 「上限非法 → run 返回 setup」这条测试写不出来了 ——
//       ValidRunConfig 让非法配置到不了 run 的门口。断言跟着规则搬到这一层。
describe("createRunConfig：非法配置在这里就被挡住", () => {
  const okLimits = {
    maxModelCalls: 9,
    maxToolRuns: 9,
    maxInputBytesPerItem: 4096,
    maxInputBytesTotal: 65536,
  };
  const base: RunConfig = {
    limits: okLimits,
    maxConcurrentTools: 2,
    maxRetries: 2,
    retryBaseMs: 1,
    userInputMode: "reject",
    toolResultMode: "truncate",
  };

  it.each<{ why: string; over: Partial<RunConfig>; kind: string }>([
    {
      why: "并发 0 —— 「一个都不并发」是错误不是配置",
      over: { maxConcurrentTools: 0 },
      kind: "invalid-concurrency",
    },
    {
      why: "并发是负数",
      over: { maxConcurrentTools: -1 },
      kind: "invalid-concurrency",
    },
    {
      why: "并发是小数",
      over: { maxConcurrentTools: 1.5 },
      kind: "invalid-concurrency",
    },
    {
      why: "并发是 NaN",
      over: { maxConcurrentTools: NaN },
      kind: "invalid-concurrency",
    },
    {
      why: "重试次数是负数",
      over: { maxRetries: -1 },
      kind: "invalid-retries",
    },
    {
      why: "退避基数是 Infinity",
      over: { retryBaseMs: Infinity },
      kind: "invalid-backoff",
    },
    {
      why: "上限非法（模型额度 0）",
      over: { limits: { ...okLimits, maxModelCalls: 0 } },
      kind: "invalid-limit",
    },
  ])("$why", ({ over, kind }) => {
    const got = createRunConfig({ ...base, ...over });
    expect(got).toMatchObject({ ok: false, error: { kind } });
  });

  it.each<{ why: string; over: Partial<RunConfig> }>([
    { why: "并发 1 —— 串行是合法配置", over: { maxConcurrentTools: 1 } },
    { why: "重试 0 —— 不重试是合法选择", over: { maxRetries: 0 } },
    { why: "退避 0 —— 测试里把等待压成 0", over: { retryBaseMs: 0 } },
  ])("$why → 通过", ({ over }) => {
    expect(createRunConfig({ ...base, ...over }).ok).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════
// NOTE: 历史归属改到用例层之后才能这么断言 ——
//       原来历史攒在适配器肚子里，从外面看不见。
// @see docs/decisions/0004-history-ownership.md
describe("历史：归用例层，每次发全量", () => {
  it("第 2 次请求带着第 1 轮的工具结果，且第 1 条永远是用户提问", async () => {
    const llm = new FakeLlm([
      {
        ok: true,
        value: {
          kind: "tool-requested",
          calls: [{ name: "list_files", id: "t1", dir: "docs" }],
        },
      },
      { ok: true, value: { kind: "completed", text: "两个文件" } },
    ]);
    const tools = new FakeTools({ t1: { kind: "ok", content: "README.md" } });
    const { result } = await collect(
      run({ llm, tools, sleep: nap }, cfgWith(), SYS, Q),
    );

    expect(result.kind).toBe("done");
    expect(llm.sent).toHaveLength(2);
    // 第 1 次：只有用户提问
    expect(llm.sent[0]).toEqual([{ role: "user", text: Q }]);
    // 第 2 次：全量 —— 提问还在，后面跟着工具结果
    expect(llm.sent[1]).toEqual([
      { role: "user", text: Q },
      {
        role: "tool-result",
        id: "t1",
        outcome: { kind: "ok", content: "README.md" },
      },
    ]);
    // system prompt 每次都带，端口无状态
    expect(llm.systems).toEqual([SYS, SYS]);
  });
});

// ══════════════════════════════════════════════════════════════
// NOTE: 这条保证原先由 decide 提供（「问不起就别跑那些工具」），
//       预算检查搬出 decide 时丢了，现在由 reserveToolRuns 的许可证找回来。
// @see docs/decisions/0005-tool-run-permit.md
describe("预算：跑完工具还得问得起模型，否则一个都不跑", () => {
  it("工具额度充足但模型额度只剩这一次 → 工具一个都不跑", async () => {
    const llm = new FakeLlm([
      {
        ok: true,
        value: {
          kind: "tool-requested",
          calls: [{ name: "list_files", id: "t1", dir: "docs" }],
        },
      },
    ]);
    const tools = new FakeTools({ t1: { kind: "ok", content: "README.md" } });
    const { result } = await collect(
      run(
        { llm, tools, sleep: nap },
        cfgWith({
          limits: {
            maxModelCalls: 1, // 本轮用掉之后就没了
            maxToolRuns: 9, // 工具额度充足
            maxInputBytesPerItem: 4096,
            maxInputBytesTotal: 65536,
          },
        }),
        SYS,
        Q,
      ),
    );

    // 报的是 model-calls：工具跑不了的原因是「跑完问不起」
    expect(result).toMatchObject({
      kind: "aborted",
      reason: {
        kind: "insufficient-budget",
        limit: "model-calls",
        used: 1,
        max: 1,
      },
    });
    // IMPORTANT: 工具一个都没跑 —— IO 和额度都没浪费
    expect(tools.seen).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════
// 以下用例来自变异测试的存活体清单（2026-09 首轮 Stryker）。
// 存活体扎堆的地方说明了一件事：原来的断言几乎只看返回值，不看事件。
// ══════════════════════════════════════════════════════════════

/** 记录每次等了多久。IMPORTANT: 退避算法只能从这里看出来，返回值里没有它。 */
function recordingSleep(): {
  waited: number[];
  sleep: (ms: number) => Promise<void>;
} {
  const waited: number[] = [];
  return {
    waited,
    sleep: (ms: number) => {
      waited.push(ms);
      return Promise.resolve();
    },
  };
}

const unavailable = (retryAfterMs: number | null) => ({
  ok: false as const,
  error: { kind: "unavailable" as const, retryAfterMs },
});

// @see docs/decisions/0011-use-case-orchestration.md §② —— 哪些错误退预算
describe("预算：unavailable 也要退回", () => {
  // 推演：轮首扣 → modelCalls=1。重试用尽仍是 unavailable，
  //       供应商没产生 token → 退 → 回到 0。
  // NOTE: 重试本身不额外扣预算，扣只发生在轮首。
  it("unavailable 重试用尽 → modelCalls 退回 0", async () => {
    const llm = new FakeLlm([
      unavailable(null),
      unavailable(null),
      unavailable(null),
    ]);
    const { result } = await collect(
      run(
        { llm, tools: new FakeTools({}), sleep: nap },
        cfgWith({ maxRetries: 2 }),
        SYS,
        Q,
      ),
    );
    expect(result).toMatchObject({
      kind: "failed",
      error: { kind: "unavailable" },
    });
    if (result.kind !== "setup") expect(result.budget.modelCalls).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════
describe("重试：退避时长", () => {
  // IMPORTANT: maxRetries 必须是 3 —— 用 2 的话指数和线性都给出 [1000, 2000]，
  //            这条断言就分不出算法被换掉了（旧仓库真踩过这个坑）。
  it("retryAfterMs 为 null → 指数退避 [1000, 2000, 4000]", async () => {
    const llm = new FakeLlm([
      unavailable(null),
      unavailable(null),
      unavailable(null),
      unavailable(null),
    ]);
    const { waited, sleep } = recordingSleep();
    await collect(
      run(
        { llm, tools: new FakeTools({}), sleep },
        cfgWith({ maxRetries: 3, retryBaseMs: 1000 }),
        SYS,
        Q,
      ),
    );
    expect(waited).toEqual([1000, 2000, 4000]);
  });

  // 30 / 70 都不等于 1000 * 2**n —— 故意选成公式算不出来的值
  it("retryAfterMs 有值 → 听供应商的，不套退避公式", async () => {
    const llm = new FakeLlm([
      unavailable(30),
      unavailable(70),
      unavailable(30),
    ]);
    const { waited, sleep } = recordingSleep();
    await collect(
      run(
        { llm, tools: new FakeTools({}), sleep },
        cfgWith({ maxRetries: 2, retryBaseMs: 1000 }),
        SYS,
        Q,
      ),
    );
    expect(waited).toEqual([30, 70]);
  });

  it("每次重试发一个 retrying 事件，带 attempt 和 afterMs", async () => {
    const llm = new FakeLlm([
      unavailable(null),
      unavailable(null),
      unavailable(null),
    ]);
    const { events } = await collect(
      run(
        { llm, tools: new FakeTools({}), sleep: nap },
        cfgWith({ maxRetries: 2, retryBaseMs: 1000 }),
        SYS,
        Q,
      ),
    );
    expect(events).toEqual([
      { kind: "turn-started", turn: 1 },
      { kind: "retrying", attempt: 1, afterMs: 1000 },
      { kind: "retrying", attempt: 2, afterMs: 2000 },
    ]);
  });
});

// ══════════════════════════════════════════════════════════════
// IMPORTANT: 事件是「函数形态选 async generator」这个决定存在的全部理由。
//            只断言 result 的话，这个形态白选了。
// @see docs/decisions/0011-use-case-orchestration.md §① —— 函数的形状
describe("事件：完整序列", () => {
  it("一轮工具调用 + 一轮回答 → 四个事件，顺序固定", async () => {
    const call = { name: "list_files" as const, id: "t1", dir: "docs" };
    const llm = new FakeLlm([
      { ok: true, value: { kind: "tool-requested", calls: [call] } },
      { ok: true, value: { kind: "completed", text: "两个文件" } },
    ]);
    const tools = new FakeTools({ t1: { kind: "ok", content: "README.md" } });
    const { events, result } = await collect(
      run({ llm, tools, sleep: nap }, cfgWith(), SYS, Q),
    );

    expect(result.kind).toBe("done");
    // 全量相等，不是 some()：漏发、多发、次序错、内容错都要红
    expect(events).toEqual([
      { kind: "turn-started", turn: 1 },
      { kind: "tool-started", call },
      {
        kind: "tool-finished",
        call,
        outcome: { kind: "ok", content: "README.md" },
      },
      { kind: "turn-started", turn: 2 },
    ]);
  });

  it("模型一次要 3 个工具 → tool-started 先全发，再发 tool-finished", async () => {
    const calls = [1, 2, 3].map((n) => ({
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
        calls.map((c) => [c.id, { kind: "ok" as const, content: c.id }]),
      ),
    );
    const { events } = await collect(
      run({ llm, tools, sleep: nap }, cfgWith(), SYS, Q),
    );
    expect(events.map((e) => e.kind)).toEqual([
      "turn-started",
      "tool-started",
      "tool-started",
      "tool-started",
      "tool-finished",
      "tool-finished",
      "tool-finished",
      "turn-started",
    ]);
    // tool-finished 的次序跟着 calls，不跟着完成先后
    // NOTE: filter 的箭头函数被推断成类型谓词，所以下面直接拿 .call 不用再收窄
    expect(
      events.filter((e) => e.kind === "tool-finished").map((e) => e.call.id),
    ).toEqual(["t1", "t2", "t3"]);
  });
});

// ══════════════════════════════════════════════════════════════
// @see docs/decisions/0011-use-case-orchestration.md §⑥ —— 工具结果怎么进上下文
describe("工具结果进上下文：两条失败路径", () => {
  const listFiles = { name: "list_files" as const, id: "t1", dir: "docs" };
  const askForTool = {
    ok: true as const,
    value: { kind: "tool-requested" as const, calls: [listFiles] },
  };

  // 推演：提问 20 字节先记账 → 剩 5。工具结果 "README.md" 9 字节 → 20+9=29 > 25。
  // 单段上限没超（9 < 4096），所以挡下来的是总额度。
  it("工具结果把总字节额度撑爆 → aborted(input-bytes-total)", async () => {
    const llm = new FakeLlm([askForTool]);
    const tools = new FakeTools({ t1: { kind: "ok", content: "README.md" } });
    const { result } = await collect(
      run(
        { llm, tools, sleep: nap },
        cfgWith({
          limits: {
            maxModelCalls: 9,
            maxToolRuns: 9,
            maxInputBytesPerItem: 4096,
            maxInputBytesTotal: 25,
          },
        }),
        SYS,
        Q,
      ),
    );
    expect(result).toMatchObject({
      kind: "aborted",
      reason: { kind: "insufficient-budget", limit: "input-bytes-total" },
    });
  });

  // 同样是 admitInput 失败，但错误不是预算 → 走 setup 而不是 aborted。
  // IMPORTANT: 这两支的分流就在 back.error.kind === "insufficient-budget" 这一行上。
  it("toolResultMode=reject 且结果超长 → setup(item-too-large)", async () => {
    const llm = new FakeLlm([askForTool]);
    const tools = new FakeTools({
      t1: { kind: "ok", content: "x".repeat(60) },
    });
    const { result } = await collect(
      run(
        { llm, tools, sleep: nap },
        cfgWith({
          toolResultMode: "reject",
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
    expect(result).toMatchObject({
      kind: "setup",
      error: { kind: "item-too-large", index: 0, bytes: 60, max: 20 },
    });
  });

  // truncate 模式下截断了，必须让模型知道 —— 否则它把半截内容当完整的用。
  it("截断的工具结果喂回模型时带 [已截断] 标记", async () => {
    const llm = new FakeLlm([
      askForTool,
      { ok: true, value: { kind: "completed", text: "读完了" } },
    ]);
    const tools = new FakeTools({
      t1: { kind: "ok", content: "x".repeat(60) },
    });
    const { result } = await collect(
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
    expect(llm.sent[1]).toEqual([
      { role: "user", text: Q },
      {
        role: "tool-result",
        id: "t1",
        outcome: { kind: "ok", content: `${"x".repeat(20)}\n[已截断]` },
      },
    ]);
  });

  // 反面：没截断就不许加标记，否则模型会以为内容不全
  it("没截断就不加标记", async () => {
    const llm = new FakeLlm([
      askForTool,
      { ok: true, value: { kind: "completed", text: "读完了" } },
    ]);
    const tools = new FakeTools({ t1: { kind: "ok", content: "README.md" } });
    await collect(run({ llm, tools, sleep: nap }, cfgWith(), SYS, Q));
    expect(llm.sent[1]?.[1]).toEqual({
      role: "tool-result",
      id: "t1",
      outcome: { kind: "ok", content: "README.md" },
    });
  });
});

// ══════════════════════════════════════════════════════════════
// 工具失败是数据不是异常（ADR 0007 §⑨）—— 所以它必须能被渲染成文本喂回模型。
// 这四支原来一条都没跑过：table 里只放过 ok。
// @see docs/decisions/0014-tool-outcome-aborted.md §① —— aborted 的措辞为什么不同
describe("工具结果：五种非 ok 的 outcome 各自的文本", () => {
  const call = { name: "read_file" as const, id: "t1", path: "f" };

  it.each<{ why: string; outcome: ToolOutcome; text: string }>([
    {
      why: "denied 带上被拒的原因 kind（不带路径本身）",
      outcome: { kind: "denied", reason: { kind: "escapes-root" } },
      text: "[工具被拒绝：escapes-root]",
    },
    {
      why: "not-found",
      outcome: { kind: "not-found" },
      text: "[工具失败：目标不存在]",
    },
    {
      why: "too-large 带上两个数字",
      outcome: { kind: "too-large", bytes: 999, max: 100 },
      text: "[工具失败：999 字节超过上限 100]",
    },
    {
      why: "failed 带上闭集里的 cause",
      outcome: { kind: "failed", cause: "timeout" },
      text: "[工具失败：timeout]",
    },
    {
      // 取消不是失败，所以措辞里没有"失败"两个字（ADR 0014 §①）
      why: "aborted 说的是取消，不是失败",
      outcome: { kind: "aborted" },
      text: "[工具已取消]",
    },
  ])("$why", async ({ outcome, text }) => {
    const llm = new FakeLlm([
      { ok: true, value: { kind: "tool-requested", calls: [call] } },
      { ok: true, value: { kind: "completed", text: "知道了" } },
    ]);
    const tools = new FakeTools({ t1: outcome });
    const { events, result } = await collect(
      run({ llm, tools, sleep: nap }, cfgWith(), SYS, Q),
    );

    // ① 返回了什么：工具失败不终止循环，模型还能接着说
    expect(result.kind).toBe("done");
    // ② 发生了什么：渲染成文本喂回去
    expect(llm.sent[1]?.[1]).toEqual({
      role: "tool-result",
      id: "t1",
      outcome: { kind: "ok", content: text },
    });
    // ③ 事件里带的是原始 outcome，不是渲染后的字符串
    expect(events).toContainEqual({ kind: "tool-finished", call, outcome });
  });
});

// ══════════════════════════════════════════════════════════════
// @see docs/decisions/0007-port-shapes.md §② —— LlmResponse 的五个 kind
// refused 和 empty 原来从没被脚本过，toOutcome 的这两支是死区。
describe("返回：refused 和 empty 都是 aborted", () => {
  it.each<{ why: string; kind: "refused" | "empty"; reason: string }>([
    { why: "模型拒答", kind: "refused", reason: "refused" },
    { why: "模型什么都没说", kind: "empty", reason: "empty-response" },
  ])("$why → aborted($reason)，且不再问第二次", async ({ kind, reason }) => {
    const llm = new FakeLlm([{ ok: true, value: { kind } }]);
    const { result } = await collect(
      run({ llm, tools: new FakeTools({}), sleep: nap }, cfgWith(), SYS, Q),
    );
    expect(result).toMatchObject({ kind: "aborted", reason: { kind: reason } });
    expect(llm.calls).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════
// NOTE: 这条是 turn.test.ts 的注释里点名要搬过来的 ——
//       decide 那一层看不到预算，所以「完成信号优先于预算耗尽」只能在这里验。
describe("返回：最后一次可负担的调用里说完了 → done", () => {
  it("模型额度 2，第二轮说完 → done 而不是 aborted，且额度正好用满", async () => {
    const call = { name: "list_files" as const, id: "t1", dir: "docs" };
    const llm = new FakeLlm([
      { ok: true, value: { kind: "tool-requested", calls: [call] } },
      { ok: true, value: { kind: "completed", text: "答完了" } },
    ]);
    const tools = new FakeTools({ t1: { kind: "ok", content: "README.md" } });
    const { result } = await collect(
      run(
        { llm, tools, sleep: nap },
        cfgWith({
          limits: {
            maxModelCalls: 2,
            maxToolRuns: 9,
            maxInputBytesPerItem: 4096,
            maxInputBytesTotal: 65536,
          },
        }),
        SYS,
        Q,
      ),
    );
    expect(result).toMatchObject({ kind: "done", text: "答完了" });
    if (result.kind !== "setup") expect(result.budget.modelCalls).toBe(2);
  });
});
