#!/usr/bin/env node
/**
 * 阶段 4 轮 D —— 流式，以及 `ports.ts` 里那个挂了两个阶段的 TODO。
 *
 * 端口给 stream 定了两条不变量（ports.ts），这里对着真 provider 验：
 *   ① 结局必须和 send 落在同一个 kind ——「同一件事经两条路径不许有两种说法」
 *   ② kind 是 completed 时，全部 text 块的 delta 拼起来 === 结尾块的 text
 *
 * 外加那个 TODO：truncated 的 partialText 要不要也走 text 块。
 * FakeLlm 不发，真适配器一定会发（截断之前的文本已经流出去了）——
 * 契约当时没说，现在有数据可以说了。
 *
 * 用法   pnpm probe:stream
 */
import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicLlm } from "../src/infra/anthropic/llm.ts";
import { DEEPSEEK_COMPAT } from "../src/infra/anthropic/providers.ts";
import type { LlmRequest } from "../src/app/ports.ts";

function env(name: string): string | undefined {
  const own = process.env[`SMOKE_${name}`];
  if (own !== undefined && own !== "") return own;
  const shared = process.env[`ANTHROPIC_${name}`];
  return shared === "" ? undefined : shared;
}

const token = env("AUTH_TOKEN");
const baseURL = env("BASE_URL");
const model = env("MODEL") ?? "claude-haiku-4-5-20251001";

if (token === undefined || baseURL === undefined) {
  console.error("缺 SMOKE_AUTH_TOKEN / SMOKE_BASE_URL，见 .env.example");
  process.exit(1);
}

const client = new Anthropic({ baseURL, authToken: token, maxRetries: 0 });

const CASES: ReadonlyArray<{
  readonly name: string;
  readonly maxTokens: number;
  readonly req: LlmRequest;
}> = [
  {
    name: "① 正常回答",
    maxTokens: 512,
    req: {
      system: "",
      history: [{ role: "user", text: "数到五，只写数字。" }],
    },
  },
  {
    name: "② 被 max_tokens 截断",
    maxTokens: 24,
    req: {
      system: "",
      history: [{ role: "user", text: "写一段一百字的散文，不要思考。" }],
    },
  },
  {
    name: "③ 要求调工具",
    maxTokens: 512,
    req: {
      system: "",
      history: [{ role: "user", text: "src 目录下有什么？" }],
    },
  },
];

for (const c of CASES) {
  const llm = createAnthropicLlm({
    client,
    model,
    maxTokens: c.maxTokens,
    capabilities: DEEPSEEK_COMPAT,
  });

  console.log(`\n${"═".repeat(66)}`);
  console.log(c.name);
  console.log("─".repeat(66));

  const sent = await llm.send(c.req);
  const sendKind = sent.ok ? sent.value.kind : `err:${sent.error.kind}`;

  const deltas: string[] = [];
  let endKind = "（没有 end 块）";
  let endText: string | null = null;
  for await (const chunk of llm.stream(c.req)) {
    if (!chunk.ok) {
      endKind = `err:${chunk.error.kind}`;
      break;
    }
    if (chunk.value.kind === "text") deltas.push(chunk.value.delta);
    else {
      const r = chunk.value.response;
      endKind = r.kind;
      endText =
        r.kind === "completed"
          ? r.text
          : r.kind === "truncated" || r.kind === "context-exceeded"
            ? r.partialText
            : null;
    }
  }

  const joined = deltas.join("");
  console.log(`send 的 kind    ${sendKind}`);
  console.log(`stream 的 kind  ${endKind}`);
  console.log(`不变量①（同 kind）      ${sendKind === endKind ? "✅" : "❌"}`);
  console.log(`text 块数量     ${String(deltas.length)}`);
  console.log(`delta 拼起来    ${JSON.stringify(joined.slice(0, 60))}`);
  console.log(
    `结尾块的文本    ${JSON.stringify(endText?.slice(0, 60) ?? null)}`,
  );
  if (endKind === "completed")
    console.log(`不变量②（拼接相等）    ${joined === endText ? "✅" : "❌"}`);
  if (endKind === "truncated")
    console.log(
      `TODO：truncated 走不走 text 块   ${deltas.length > 0 ? "走了" : "没走"}` +
        `，partialText 和拼接${joined === endText ? "一致" : "不一致"}`,
    );
}
