#!/usr/bin/env node
/**
 * 阶段 4 轮 A 的冒烟脚本 —— 打通「真 key → 真响应 → LlmResponse」一条线。
 *
 * 它不是测试，是**测量装置**：目的是把真实 provider 的原始响应打印出来，
 * 让 roadmap 里那几个「❓待亲手验证」变成写下来的事实。所以它先打印原始
 * Message（stop_reason / content 块的类型 / usage），再打印压出来的端口语义。
 *
 * 唯一读环境变量的地方就是这里 —— src/ 不碰 process.env（见 infra/anthropic/llm.ts）。
 *
 * 用法
 *   pnpm smoke                      用默认问题
 *   pnpm smoke "你的问题"           指定问题
 *
 * 需要的环境变量（放 .env，已经在 .gitignore 里）：
 *   SMOKE_AUTH_TOKEN=<provider 的 key>
 *   SMOKE_BASE_URL=https://api.deepseek.com/anthropic
 *   SMOKE_MODEL=claude-haiku-4-5-20251001            可选，有默认值
 *
 * TRAP: 为什么不叫 ANTHROPIC_* —— 2026-09 实测。
 *   Node 的 --env-file 只**补**进程里没有的变量，已经存在的一律不动。
 *   而 ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL 是 SDK 和 Claude Code 都认的
 *   约定名，某些 shell 里本来就有值 —— 于是 .env 被静默忽略，请求打到别的端点，
 *   而且不报错（那次碰巧 401 才被发现，两边 key 都有效的话就是一份
 *   看起来正常、其实来自另一个 provider 的输出）。
 *   私有的值要用私有的名字。ANTHROPIC_* 仍然接受，但优先级在后。
 */
import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicLlm } from "../src/infra/anthropic/llm.ts";
import { DEEPSEEK_COMPAT } from "../src/infra/anthropic/providers.ts";
import { TOOLS, toResponse } from "../src/infra/anthropic/map.ts";

/** 私有名优先，兼容名兜底。空串按「没设」处理。 */
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
/** 打印出来好排障：值来自哪一个名字。上面那个 TRAP 就是这样才看得见的 */
const source = (name: string): string =>
  process.env[`SMOKE_${name}`] !== undefined &&
  process.env[`SMOKE_${name}`] !== ""
    ? `SMOKE_${name}`
    : `ANTHROPIC_${name}`;

if (token === undefined) {
  console.error("缺 SMOKE_AUTH_TOKEN。把它写进 MyAgent/.env，不要写进代码。");
  process.exit(1);
}
if (baseURL === undefined) {
  console.error(
    "缺 SMOKE_BASE_URL。DeepSeek 是 https://api.deepseek.com/anthropic",
  );
  process.exit(1);
}

const question = process.argv[2] ?? "用一句话说明什么是纯函数。";

// 打印能确认「打到了哪里」的信息，但不打印 key 本身
console.log("─".repeat(66));
console.log(`baseURL   ${baseURL}   ← ${source("BASE_URL")}`);
console.log(`model     ${model}   ← ${source("MODEL")}`);
console.log(
  `key       长度 ${String(token.length)}，前 4 位 ${token.slice(0, 4)}…`,
);
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
