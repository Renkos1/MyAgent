import { describe, it, expect } from "vitest";
import { collect, run } from "../../src/app/runTurn.ts";
import { FakeLlm } from "../../src/infra/fake/llm.ts";
import { FakeTools } from "../../src/infra/fake/tools.ts";
import type { RunConfig } from "../../src/app/runTurn.ts";

describe("runTurn", () => {
  const cfg: RunConfig = {
    limits: {
      maxModelCalls: 1,
      maxToolRuns: 1,
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
        calls: [{ name: "list_files", id: "t1", dir: "docs" }],
      },
    },
    { ok: true, value: { kind: "completed", text: "模型调用不可达" } },
  ]);

  const tools = new FakeTools({
    t1: { kind: "ok", content: "README.md\nMAP.md" },
    t2: { kind: "ok", content: "工具不可达" },
  });

  describe("不变量", () => {
    it("契约④", async () => {
      const { result } = await collect(
        run(
          { llm, tools, sleep: () => Promise.resolve() },
          cfg,
          "你是仓库助手。",
          "docs 下有什么？",
        ),
      );

      expect(result).toMatchObject({
        kind: "aborted",
        reason: {
          kind: "insufficient-budget",
          limit: "model-calls",
        },
      });
    });
  });
});
