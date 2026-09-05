/**
 * ★composition root★ —— 全项目唯一 import infra 的地方。
 *
 * 阶段 2 的验收标准就是这个文件能跑出下面的输出：
 * ★用例层在没有网络、没有账单、输出完全确定的情况下跑完了一整轮循环。★
 * 换成真适配器时，改的只有这里的两个 new。
 *
 *     pnpm dev
 */
import { collect, run } from "./app/runTurn.ts";
import type { RunConfig } from "./app/runTurn.ts";
import { FakeLlm } from "./infra/fake/llm.ts";
import { FakeTools } from "./infra/fake/tools.ts";

const cfg: RunConfig = {
  limits: {
    maxModelCalls: 4,
    maxToolRuns: 4,
    maxInputBytesPerItem: 4096,
    maxInputBytesTotal: 65536,
  },
  maxConcurrentTools: 2,
  maxRetries: 2,
  retryBaseMs: 10,
  userInputMode: "reject",
  toolResultMode: "truncate",
};

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
  { ok: true, value: { kind: "completed", text: "docs/ 下有 2 个文件。" } },
]);

const tools = new FakeTools({
  t1: { kind: "ok", content: "README.md\nMAP.md" },
  t2: { kind: "ok", content: "# 文档入口" },
});

const { events, result } = await collect(
  run(
    { llm, tools, sleep: () => Promise.resolve() },
    cfg,
    "你是仓库助手。",
    "docs 下有什么？",
  ),
);

for (const e of events) console.log("·", e.kind);
console.log("\n结果  ", result.kind);
if (result.kind === "done") console.log("答案  ", result.text);
if (result.kind !== "setup") {
  console.log(
    "预算  ",
    `模型 ${String(result.budget.modelCalls)}/${String(cfg.limits.maxModelCalls)}`,
    `工具 ${String(result.budget.toolRuns)}/${String(cfg.limits.maxToolRuns)}`,
    `字节 ${String(result.budget.inputBytes)}`,
  );
}
console.log(
  "并发峰值",
  tools.peakConcurrency,
  "／上限",
  cfg.maxConcurrentTools,
);
