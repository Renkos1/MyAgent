#!/usr/bin/env node
/**
 * 录音带的录制脚本 —— 阶段 3 建好机制、阶段 4 才有内容的那一步。
 *
 * @remarks
 * 它按 `test/contract/tapePlan.ts` 逐条驱动真适配器，把 HTTP 往返录到
 * `test/cassettes/`。之后契约套件就能对**真适配器**跑，不要网络、不花钱。
 *
 * IMPORTANT: 每条 take 录四次往返 ——
 *   ① 非流式 × 1     契约套件的 send 类断言会重复问，回放按指纹取，一条够
 *   ② 流式   × 1     body 里多一个 stream:true，指纹不同，必须单独录
 * 录完当场校验：压出来的 kind 必须等于场景声明的 kind，不等就不存盘。
 * 录一盘对不上契约的带子，比没有带子更糟 —— 它会让契约套件绿得毫无意义。
 *
 * 用法   pnpm record            录全部
 *        pnpm record completed  只录一条
 */
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync } from "node:fs";
import { createAnthropicLlm } from "../src/infra/anthropic/llm.ts";
import { DEEPSEEK_COMPAT } from "../src/infra/anthropic/providers.ts";
import { recording, widenForSdk } from "../src/infra/tape/http.ts";
import { saveCassette } from "../src/infra/tape/cassette.ts";
import { SCENARIOS } from "../test/contract/scenarios.ts";
import { TAPE_PLAN, TAPE_SYSTEM } from "../test/contract/tapePlan.ts";
import { loadEnvOrExit } from "./load-env.ts";

const { authToken, baseURL, model } = loadEnvOrExit("record");
const token = authToken.expose();

const DIR = "test/cassettes";
const PROVIDER = "deepseek-compat";
const only = process.argv[2];
const today = new Date().toISOString().slice(0, 10);

mkdirSync(DIR, { recursive: true });

for (const take of TAPE_PLAN) {
  if (only !== undefined && only !== take.name) continue;

  const { fetch: taped, cassette } = recording(globalThis.fetch, {
    name: take.name,
    provider: PROVIDER,
    recordedAt: today,
    apiVersion: model,
  });

  const llm = createAnthropicLlm({
    client: new Anthropic({
      baseURL,
      authToken: take.badKey === true ? "sk-not-a-real-key" : token,
      maxRetries: 0,
      fetch: widenForSdk(taped),
    }),
    model,
    maxTokens: take.maxTokens,
    capabilities: DEEPSEEK_COMPAT,
  });

  const req = {
    system: TAPE_SYSTEM,
    history: [{ role: "user" as const, text: take.ask }],
  };

  const sent = await llm.send(req);
  for await (const _ of llm.stream(req)) void _;

  // 录到的东西必须真的就是场景声明的那一格，否则不存
  const want = SCENARIOS[take.name].expected;
  const gotKind = sent.ok ? sent.value.kind : sent.error.kind;
  const gotCalls =
    sent.ok && sent.value.kind === "tool-requested"
      ? sent.value.calls.length
      : 0;
  const okKind = gotKind === want.kind;
  const okCalls = !want.ok || want.toolCalls === gotCalls;

  const tape = cassette();
  console.log(
    `${take.name.padEnd(20)} 往返 ${String(tape.exchanges.length)}  ` +
      `kind=${gotKind}${want.ok ? `  calls=${String(gotCalls)}` : ""}  ` +
      (okKind && okCalls ? "存盘" : "不符，不存"),
  );
  if (!okKind || !okCalls) {
    console.log(`  想要 ${JSON.stringify(want)}，${take.how}`);
    continue;
  }
  console.log(`  → ${saveCassette(DIR, tape)}`);
}
