#!/usr/bin/env node
/**
 * 阶段 4 轮 B 的测量装置 —— 工具调用这一格，provider 到底支持到什么程度。
 *
 * 不会 400 只排除了「拒绝」这一种行为，没有区分「静默忽略」和「真支持」。
 * 这个脚本问三件事，每一件都有一个能证伪的观测点：
 *
 *   ① 会不会调         stop_reason === "tool_use"
 *   ② input 合不合 schema  toToolCall 收窄成不成功
 *   ③ 能不能并发       ★一条 assistant 消息里有几个 tool_use 块★
 *                      并发是 runTurn 里 maxConcurrentTools 存在的前提 ——
 *                      provider 只肯一个一个来的话，那个配置就是死代码
 *
 *   外加  thinking 块长什么样、带不带 signature ——
 *         决定 toMessages 重建 assistant 消息时丢掉它要不要紧（ADR 0018 的缺口）
 *
 * 环境变量同 smoke.ts（SMOKE_* 优先，ANTHROPIC_* 兜底）。
 *
 * 用法   pnpm probe:tools
 */
import Anthropic from "@anthropic-ai/sdk";
import { TOOLS, toResponse } from "../src/infra/anthropic/map.ts";

function env(name: string): string | undefined {
  const own = process.env[`SMOKE_${name}`];
  if (own !== undefined && own !== "") return own;
  const shared = process.env[`ANTHROPIC_${name}`];
  return shared === "" ? undefined : shared;
}

const token = env("AUTH_TOKEN");
const baseURL = env("BASE_URL");
const model = env("MODEL") ?? "claude-haiku-4-5-20251001";
const maxTokens = Number(env("MAX_TOKENS") ?? "1024");

if (token === undefined || baseURL === undefined) {
  console.error("缺 SMOKE_AUTH_TOKEN / SMOKE_BASE_URL，见 .env.example");
  process.exit(1);
}

const client = new Anthropic({ baseURL, authToken: token, maxRetries: 0 });

/**
 * 三个探针。每个都写清「期望看到什么」——
 * IMPORTANT: 这不是断言，是预测。先写下来，跑完对一遍，不一致的地方才是产出。
 */
const PROBES: ReadonlyArray<{
  readonly name: string;
  readonly question: string;
  readonly expect: string;
}> = [
  {
    name: "① 会不会调",
    question: "src 目录下都有哪些文件？",
    expect: 'stop_reason "tool_use"，一个 list_files 块',
  },
  {
    name: "② 并发",
    question: "同时看一下 src 和 test 两个目录里各有什么文件。",
    expect: "一条 assistant 消息里两个 list_files 块，dir 分别是 src 和 test",
  },
  {
    name: "③ 不需要工具时",
    question: "1 加 1 等于几？直接回答，不要用工具。",
    expect: 'stop_reason "end_turn"，零个 tool_use 块',
  },
];

for (const probe of PROBES) {
  console.log(`\n${"═".repeat(66)}`);
  console.log(`${probe.name}   ${probe.question}`);
  console.log(`预测   ${probe.expect}`);
  console.log("─".repeat(66));

  const msg = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: "你在回答关于一个代码仓库的问题。需要看文件时就调用工具。",
    messages: [{ role: "user", content: probe.question }],
    tools: [...TOOLS],
  });

  console.log(`stop_reason   ${JSON.stringify(msg.stop_reason)}`);
  console.log(
    `块类型        ${JSON.stringify(msg.content.map((b) => b.type))}`,
  );

  const toolUses = msg.content.filter((b) => b.type === "tool_use");
  console.log(`tool_use 个数 ${String(toolUses.length)}`);
  for (const t of toolUses) {
    console.log(`  ${t.name}  input=${JSON.stringify(t.input)}  id=${t.id}`);
  }

  // thinking 块的形状：有没有 signature 决定它能不能被原样发回去
  const thinking = msg.content.filter(
    (b) => b.type === "thinking" || b.type === "redacted_thinking",
  );
  if (thinking.length > 0) {
    console.log(`thinking 块   ${String(thinking.length)} 个，字段：`);
    for (const t of thinking) {
      console.log(`  ${JSON.stringify(Object.keys(t))}`);
    }
  }

  console.log(`toResponse    ${JSON.stringify(toResponse(msg))}`);
  console.log(`usage         ${JSON.stringify(msg.usage)}`);
}
