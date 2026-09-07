#!/usr/bin/env node
/**
 * 阶段 4 轮 C —— 错误路径。`toError` 的四格，第一次对着真头验。
 *
 * toError 是纯函数，单元测试里喂的是**我们自己造的** APIError。
 * 那验的是「给定这个输入，映射对不对」，验不了「供应商真的会给这个输入吗」。
 * 这个脚本补的就是后半句。
 *
 * 四个探针，每个对应 LlmError 的一格：
 *   ① 坏 key       → rejected      重试没用
 *   ② 不存在的模型 → rejected      请求本身不合法
 *   ③ signal 提前 abort → aborted  我们自己叫停的
 *   ④ max_tokens=1 → 不是错误    truncated，走 LlmResponse 那一侧
 *
 * ④ 放在这里是故意的：它长得像失败，但端口把它归成成功响应的一格。
 * 「错误分支表示没问到模型」这条判据，只有把它和 ①②③ 并排跑才看得清。
 *
 * 用法   pnpm probe:errors
 */
import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicLlm } from "../src/infra/anthropic/llm.ts";
import { DEEPSEEK_COMPAT } from "../src/infra/anthropic/providers.ts";
import { loadEnvOrExit } from "./load-env.ts";

const { authToken, baseURL, model } = loadEnvOrExit("probe-errors");
const token = authToken.expose();

const req = { system: "", history: [{ role: "user" as const, text: "hi" }] };

/** 造一个适配器，参数可以逐个替换掉。 */
function llm(over: {
  token?: string;
  model?: string;
  maxTokens?: number;
}): ReturnType<typeof createAnthropicLlm> {
  return createAnthropicLlm({
    client: new Anthropic({
      baseURL,
      authToken: over.token ?? token,
      maxRetries: 0,
    }),
    model: over.model ?? model,
    maxTokens: over.maxTokens ?? 1024,
    capabilities: DEEPSEEK_COMPAT,
  });
}

/** 顺便把原始 HTTP 状态和头也打出来 —— 映射对不对要看得见原料。 */
async function raw(
  label: string,
  over: { token?: string; model?: string },
): Promise<void> {
  try {
    await new Anthropic({
      baseURL,
      authToken: over.token ?? token,
      maxRetries: 0,
    }).messages.create({
      model: over.model ?? model,
      max_tokens: 16,
      messages: [{ role: "user", content: "hi" }],
    });
    console.log(`${label} 原始   没报错`);
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      // NOTE: SDK 把 headers 标成 any，收窄一次再用，否则 strictTypeChecked 报
      //       no-unsafe-member-access。
      const h: Headers | undefined =
        e.headers instanceof Headers ? e.headers : undefined;
      const ra = h?.get("retry-after") ?? null;
      const ram = h?.get("retry-after-ms") ?? null;
      const sr = h?.get("x-should-retry") ?? null;
      console.log(
        `${label} 原始   status=${String(e.status)}` +
          `  retry-after=${JSON.stringify(ra)}` +
          `  retry-after-ms=${JSON.stringify(ram)}` +
          `  x-should-retry=${JSON.stringify(sr)}`,
      );
      console.log(`${label}        message=${e.message.slice(0, 160)}`);
      return;
    }
    throw e;
  }
}

console.log("═".repeat(66));
console.log("① 坏 key");
await raw("①", { token: "sk-definitely-not-a-real-key" });
console.log(
  `① 端口   ${JSON.stringify(await llm({ token: "sk-definitely-not-a-real-key" }).send(req))}`,
);

console.log(`\n${"═".repeat(66)}`);
console.log("② 不存在的模型");
await raw("②", { model: "claude-does-not-exist-9" });
console.log(
  `② 端口   ${JSON.stringify(await llm({ model: "claude-does-not-exist-9" }).send(req))}`,
);

console.log(`\n${"═".repeat(66)}`);
console.log("③ 进来之前就 abort");
const ac = new AbortController();
ac.abort();
console.log(
  `③ 端口   ${JSON.stringify(await llm({}).send(req, { signal: ac.signal }))}`,
);

console.log(`\n${"═".repeat(66)}`);
console.log("④ max_tokens=1 —— 不是错误，是 truncated");
console.log(
  `④ 端口   ${JSON.stringify(await llm({ maxTokens: 1 }).send(req))}`,
);
