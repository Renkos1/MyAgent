/**
 * composition root —— IMPORTANT: 全项目唯一 import infra 的地方。
 *
 * 阶段 2 写下过一句话：「换成真适配器时，改的只有这里的两个 new。」
 * 阶段 5 是兑现它的那一天 —— 下面确实只换了一个 new，外加前面那段读配置的代码。
 *
 * ## 这个文件承担的是「边界」这一层的职责（决定 D3）
 *
 * `readEnv` 和 `createRunConfig` 都返回 `Result`，因为它们说不出「该怎么办」。
 * 决定「怎么办」的是这里：**打印全部问题，然后非 0 退出**。
 *
 * IMPORTANT: 是「全部」不是「第一个」。缺三个变量报一个、改完再报下一个，
 * 等于让人启动三次才知道全貌 —— 阶段 5 的验收标准写的是「说清缺什么」。
 *
 *     pnpm dev                     起 HTTP 服务
 *     curl -N -X POST localhost:3000/chat -d '{"question":"..."}'
 *
 * IMPORTANT: 阶段 6 起入口是 HTTP，命令行那条一次性路径删掉了 ——
 * 留着就是第二条实现路径（ADR 0021 D1 明确不要）。
 *
 * 需要的环境变量见 `.env.example`。SAFETY: 真 key 只放 `.env`。
 */
import Anthropic from "@anthropic-ai/sdk";
import { createChatServer } from "./infra/http/server.ts";
import { withCallTimeout } from "./infra/timeout.ts";
import { createRunConfig } from "./app/config.ts";
import type { RunConfig } from "./app/config.ts";
import { readEnv, sourceOf } from "./infra/env.ts";
import { createAnthropicLlm } from "./infra/anthropic/llm.ts";
import { DEEPSEEK_COMPAT } from "./infra/anthropic/providers.ts";
import { FakeTools } from "./infra/fake/tools.ts";

// ── ① 环境 ────────────────────────────────────────────────────────
const env = readEnv(process.env);
if (!env.ok) {
  console.error("启动失败：环境变量不对。全部问题如下 ——\n");
  for (const i of env.error) console.error(`  ${i.name}\n      ${i.why}\n`);
  console.error("照着 .env.example 复制一份 .env 再填。");
  process.exit(1);
}

// NOTE: 打印「值来自哪个变量名」是排障用的。阶段 4 那个 TRAP（ANTHROPIC_* 被
//       shell 抢走、.env 被静默忽略）只有靠这一行才看得见。key 本身不打印。
console.log(
  `baseURL   ${env.value.baseURL}   <- ${sourceOf(process.env, "BASE_URL") ?? "?"}`,
);
console.log(
  `model     ${env.value.model}   <- ${sourceOf(process.env, "MODEL") ?? "?"}`,
);
console.log(`key       ${String(env.value.authToken)}`);

// ── ② 领域配置 ────────────────────────────────────────────────────
const raw: RunConfig = {
  limits: {
    maxModelCalls: 4,
    maxToolRuns: 4,
    maxInputBytesPerItem: 4096,
    maxInputBytesTotal: 65536,
  },
  maxConcurrentTools: 2,
  maxRetries: 2,
  retryBaseMs: 500,
  userInputMode: "reject",
  toolResultMode: "truncate",
};

const built = createRunConfig(raw);
if (!built.ok) {
  console.error(`配置非法：${built.error.kind}`);
  process.exit(1);
}
const cfg = built.value;

// ── ③ 适配器 ──────────────────────────────────────────────────────
// IMPORTANT: maxRetries: 0 —— 重试归用例层管。SDK 再来一层的话实际请求次数是
//            两层相乘，RunConfig.maxRetries 这个配置就在说谎。
const llm = withCallTimeout(
  createAnthropicLlm({
    client: new Anthropic({
      baseURL: env.value.baseURL,
      authToken: env.value.authToken.expose(),
      maxRetries: 0,
    }),
    model: env.value.model,
    maxTokens: env.value.maxTokens,
    capabilities: DEEPSEEK_COMPAT,
  }),
  env.value.upstreamTimeoutMs,
);

// TODO: 工具还是假的 —— 真的文件系统适配器还没建（阶段 1 的 resolveInsideRoot
//       和 size 规则至今没有一个真调用方）。在它建起来之前，默认问题是一句
//       不需要工具的问题；问需要读文件的问题会得到「工具没配」。
const tools = new FakeTools({});

// ── ④ 起服务 ────────────────────────────────────────────────────
const server = createChatServer({
  deps: { llm, tools, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
  cfg,
  systemPrompt: "你在回答关于一个代码仓库的问题。",
  requestTimeoutMs: env.value.requestTimeoutMs,
});

server.listen(env.value.port, () => {
  console.log(`\n监听    http://localhost:${String(env.value.port)}`);
  console.log(
    `超时    整条 ${String(env.value.requestTimeoutMs)}ms / 单次上游 ${String(env.value.upstreamTimeoutMs)}ms`,
  );
  console.log(
    `试试    curl -N -X POST localhost:${String(env.value.port)}/chat ` +
      `-H 'content-type: application/json' -d '{"question":"什么是纯函数"}'`,
  );
});
