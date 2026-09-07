#!/usr/bin/env node
/**
 * 阶段 4 轮 A 的冒烟脚本 —— 打通「真 key → 真响应 → LlmResponse」一条线。
 *
 * 它不是测试，是**测量装置**：目的是把真实 provider 的原始响应打印出来，
 * 让 roadmap 里那几个「❓待亲手验证」变成写下来的事实。所以它先打印原始
 * Message（stop_reason / content 块的类型 / usage），再打印压出来的端口语义。
 *
 * 用法
 *   pnpm smoke                      用默认问题
 *   pnpm smoke "你的问题"           指定问题
 *
 * 需要的环境变量见 .env.example。
 *
 * NOTE: 阶段 5 之前，读环境变量的地方就是这里；现在 parse 收进了
 *   src/infra/env.ts，这个脚本只负责「读不出来就退出」这一个决定。
 *   前缀也从 SMOKE_ 改成了 AGENT_（决定 D7）——
 *   TRAP 还是那一条：Node 的 --env-file 只**补**进程里没有的变量，
 *   而 ANTHROPIC_* 是 SDK 和 Claude Code 都认的约定名，某些 shell 里本来就有值，
 *   于是 .env 被静默忽略、请求打到别的端点、而且不报错。
 */
import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicLlm } from "../src/infra/anthropic/llm.ts";
import { DEEPSEEK_COMPAT } from "../src/infra/anthropic/providers.ts";
import { TOOLS, toResponse } from "../src/infra/anthropic/map.ts";
import { sourceOf } from "../src/infra/env.ts";
import { loadEnvOrExit } from "./load-env.ts";

const { authToken, baseURL, model, maxTokens } = loadEnvOrExit("smoke");
const token = authToken.expose();

/** 打印出来好排障：值来自哪一个名字。上面那个 TRAP 就是这样才看得见的 */
const source = (name: string): string => sourceOf(process.env, name) ?? "?";

const question = process.argv[2] ?? "用一句话说明什么是纯函数。";

// 打印能确认「打到了哪里」的信息，但不打印 key 本身
console.log("─".repeat(66));
console.log(`baseURL   ${baseURL}   <- ${source("BASE_URL")}`);
console.log(`model     ${model}   <- ${source("MODEL")}`);
// SAFETY: 不打印 key 的任何片段。阶段 4 这里打过「长度 + 前 4 位」，
//         阶段 5 去掉了 —— 它想回答的是「我用的是哪个 key」，而上面那两行
//         sourceOf 已经把这个问题回答得更准（值来自哪个变量名）。
//         前 4 位对带固定前缀的 key 几乎不含信息，却是一条真的泄露路径。
console.log(`key       ${String(authToken)}`);
console.log(`问题      ${question}`);
console.log("─".repeat(66));

// IMPORTANT: maxRetries: 0 —— 重试归用例层，SDK 不许自己再来一层
const client = new Anthropic({ baseURL, authToken: token, maxRetries: 0 });

// ── ① 直接调一次，看原始响应 ──────────────────────────────────────
const raw = await client.messages.create({
  model,
  max_tokens: maxTokens,
  messages: [{ role: "user", content: question }],
  tools: [...TOOLS],
});

console.log("\n【原始 Message】");
console.log(JSON.stringify(raw, null, 2));

console.log("\n【几个要点】");
console.log(`stop_reason    ${JSON.stringify(raw.stop_reason)}`);
console.log(`stop_details   ${JSON.stringify(raw.stop_details ?? null)}`);
console.log(`content 块类型 ${JSON.stringify(raw.content.map((b) => b.type))}`);
console.log(`usage          ${JSON.stringify(raw.usage)}`);

console.log("\n【toResponse 压出来的端口语义】");
console.log(JSON.stringify(toResponse(raw), null, 2));

// ── ② 再走一次适配器，确认整条线是通的 ────────────────────────────
const llm = createAnthropicLlm({
  client,
  model,
  maxTokens,
  capabilities: DEEPSEEK_COMPAT,
});
const res = await llm.send({
  system: "你在回答关于一个代码仓库的问题。",
  history: [{ role: "user", text: question }],
});

console.log("\n【适配器 send 的结果】");
console.log(JSON.stringify(res, null, 2));
