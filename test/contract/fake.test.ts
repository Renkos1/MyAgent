/**
 * 把两个 Fake 送进契约套件。
 *
 * IMPORTANT: 这是 Fake 第一次成为**被测对象**。在此之前它只是 runTurn 测试里的道具 ——
 * 42 个用例全部 new FakeLlm([脚本])，而脚本是我摆的，断言也是我写的：
 * 那个绿只证明「我和我自己一致」。
 *
 * 阶段 4 加真适配器时，这个文件旁边多一个 anthropic.test.ts，
 * 导入的是同一份套件 —— 那时候 cannotStage 里的名字就是能力矩阵。
 */
import type { ToolCall, ToolOutcome, ToolPort } from "../../src/app/ports.ts";
import { FakeLlm } from "../../src/infra/fake/llm.ts";
import type { Scripted } from "../../src/infra/fake/llm.ts";
import { FakeTools } from "../../src/infra/fake/tools.ts";
import { llmPortContract } from "./llmPort.contract.ts";
import { toolPortContract } from "./toolPort.contract.ts";
import type { Scenario } from "./scenarios.ts";

/**
 * 场景 → 脚本里的一格。
 *
 * TRAP: aborted-before-send 故意配一条 completed 脚本 —— 契约要求
 *       「signal 已 abort 就一律 err(aborted)，不管脚本说什么」。
 *       配成 err(aborted) 的话，实现就算根本不看 signal 也能过。
 */
function scriptFor(s: Scenario): Scripted | null {
  switch (s.name) {
    case "completed":
      return {
        ok: true,
        value: { kind: "completed", text: "docs 下有 2 个文件" },
      };
    case "tool-requested-one":
      return {
        ok: true,
        value: {
          kind: "tool-requested",
          calls: [{ name: "list_files", id: "c1", dir: "docs" }],
        },
      };
    case "tool-requested-many":
      return {
        ok: true,
        value: {
          kind: "tool-requested",
          calls: [
            { name: "list_files", id: "c1", dir: "docs" },
            { name: "read_file", id: "c2", path: "docs/README.md" },
            { name: "search", id: "c3", query: "预算" },
          ],
        },
      };
    case "truncated":
      return {
        ok: true,
        value: { kind: "truncated", partialText: "docs 下有" },
      };
    case "refused":
      return { ok: true, value: { kind: "refused" } };
    case "empty":
      return { ok: true, value: { kind: "empty" } };
    case "rate-limited-with-hint":
      return { ok: false, error: { kind: "unavailable", retryAfterMs: 1500 } };
    case "rate-limited-no-hint":
    case "server-error":
    case "network-interrupted":
    case "timeout":
      return { ok: false, error: { kind: "unavailable", retryAfterMs: null } };
    case "unauthorized":
    case "bad-request":
      return { ok: false, error: { kind: "rejected" } };
    case "malformed":
      return { ok: false, error: { kind: "malformed" } };
    case "aborted-before-send":
      return { ok: true, value: { kind: "completed", text: "不该看到这句" } };

    // 摆不出：FakeLlm 在 take() 开头查一次 signal 就返回，
    // 没有「请求已经出去了」这个中间状态可言。
    case "aborted-mid-flight":
      return null;
  }
}

llmPortContract({
  name: "FakeLlm",
  cannotStage: ["aborted-mid-flight"],
  stage: (s) => {
    const item = scriptFor(s);
    // 套件对同一个端口最多问 3 次；多备一格，问超了让 FakeLlm 自己炸出来
    return item === null ? null : new FakeLlm([item, item, item, item]);
  },
});

const CALL: Readonly<Record<ToolOutcome["kind"], ToolCall>> = {
  ok: { name: "read_file", id: "ok", path: "docs/README.md" },
  denied: { name: "read_file", id: "denied", path: "../../etc/passwd" },
  "not-found": { name: "read_file", id: "missing", path: "docs/nope.md" },
  "too-large": { name: "read_file", id: "big", path: "docs/huge.md" },
  failed: { name: "search", id: "boom", query: "预算" },
  // TRAP: 故意用 ok 那一格的 call —— 表里 "ok" 是有答案的，
  //       实现必须让 signal 压过它，才算真的看了 signal。
  aborted: { name: "read_file", id: "ok", path: "docs/README.md" },
};

const TABLE: Readonly<Record<string, ToolOutcome>> = {
  ok: { kind: "ok", content: "# 文档入口" },
  denied: { kind: "denied", reason: { kind: "escapes-root" } },
  big: { kind: "too-large", bytes: 999_999, max: 4096 },
  boom: { kind: "failed", cause: "io-error" },
  // NOTE: "missing" 故意不进表 —— FakeTools 查不到就返回 not-found，
  //       所以这一格测的是它的兜底路径，不是表里摆好的答案
};

const tools: ToolPort = new FakeTools(TABLE, 0);

toolPortContract({
  name: "FakeTools",
  cannotStage: [],
  stage: (kind) => ({
    port: tools,
    call: CALL[kind],
    opts: kind === "aborted" ? { signal: AbortSignal.abort() } : undefined,
  }),
  surprise: {
    port: tools,
    call: { name: "list_files", id: "从来没见过的 id", dir: "docs" },
  },
});
