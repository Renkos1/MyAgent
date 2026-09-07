#!/usr/bin/env node
/**
 * 阶段 4 轮 B 收尾 —— thinking 块到底能不能丢。
 *
 * `toMessages` 重建 assistant 消息时只放 tool_use 块（ADR 0018），
 * 而真实响应里还有一个带 signature 的 thinking 块。签名的存在说明它是要被
 * 验的，但「谁验、验不过会怎样」只有跑一次完整往返才知道。
 *
 * 两个变体跑同一段历史，唯一差别是 assistant 那条带不带 thinking 块：
 *
 *   ① 丢掉 thinking   = toMessages 现在的行为
 *   ② 原样带回        = 候选 A/B 要做的事
 *
 * 判据   ① 报 400 而 ② 成功  → thinking 必须带回，契约要改
 *        两个都成功          → 这个 provider 不验签，进能力矩阵
 *        两个都失败          → 是别的问题，先查错误消息
 *
 * 用法   pnpm probe:roundtrip
 */
import Anthropic from "@anthropic-ai/sdk";
import { TOOLS } from "../src/infra/anthropic/map.ts";

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
const SYSTEM = "你在回答关于一个代码仓库的问题。需要看文件时就调用工具。";
const QUESTION = "同时看一下 src 和 test 两个目录里各有什么文件。";

// ── 第 1 轮：拿到带 thinking 的 assistant 响应 ─────────────────────
const first = await client.messages.create({
  model,
  max_tokens: maxTokens,
  system: SYSTEM,
  messages: [{ role: "user", content: QUESTION }],
  tools: [...TOOLS],
});

console.log(`第 1 轮   stop_reason=${JSON.stringify(first.stop_reason)}`);
console.log(`          块=${JSON.stringify(first.content.map((b) => b.type))}`);

const toolUses = first.content.filter((b) => b.type === "tool_use");
if (toolUses.length === 0) {
  console.error("模型这次没调工具，换个问题再试");
  process.exit(1);
}

/** 假装工具跑完了。内容是什么不重要，形状对就行。 */
const results: Anthropic.ToolResultBlockParam[] = toolUses.map((t) => ({
  type: "tool_result",
  tool_use_id: t.id,
  content: "index.ts\nutil.ts",
}));

/** 一次第 2 轮请求。assistant 那条的内容由调用方决定。 */
async function secondTurn(
  label: string,
  assistantContent: Anthropic.ContentBlockParam[],
): Promise<void> {
  console.log(`\n${"═".repeat(66)}`);
  console.log(label);
  console.log(
    `assistant 块  ${JSON.stringify(assistantContent.map((b) => b.type))}`,
  );
  try {
    const msg = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: SYSTEM,
      messages: [
        { role: "user", content: QUESTION },
        { role: "assistant", content: assistantContent },
        { role: "user", content: results },
      ],
      tools: [...TOOLS],
    });
    console.log(`成功   stop_reason=${JSON.stringify(msg.stop_reason)}`);
    console.log(`       块=${JSON.stringify(msg.content.map((b) => b.type))}`);
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      console.log(`失败   ${String(e.status)}  ${e.message.slice(0, 300)}`);
      return;
    }
    throw e;
  }
}

// ① toMessages 现在的行为：只留 tool_use
await secondTurn(
  "① 丢掉 thinking（= toMessages 现状）",
  toolUses.map((t) => ({
    type: "tool_use" as const,
    id: t.id,
    name: t.name,
    input: t.input,
  })),
);

// ② 原样带回全部块
await secondTurn("② 原样带回 thinking", first.content);
