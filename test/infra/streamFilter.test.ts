/**
 * 流式的一条定向测试：**thinking 的增量不许当成文本发出去**。
 *
 * @remarks
 * IMPORTANT: 这里用的是**手工构造的 SSE**，不是录音带 —— 这是有意的，
 * 而且理由值得写下来。
 *
 * 变异检查时把 `stream` 里的过滤条件放宽成「thinking_delta 也发」，
 * 契约套件 37 个断言一个都没红。排查下来是两个原因叠在一起：
 *
 * ```text
 * completed 那盘带子            那一轮模型的 thinking 文本恰好是空的
 *                               ⇒ 放宽了也多不出 delta，分支不在场
 * tool-requested-many 那盘      thinking_delta 有，放宽后吐出 35 个块
 *                               ⇒ 分支在场，但没有断言看着它
 * ```
 *
 * 根因是后者：契约套件唯一断言中间块的那条只对 `completed` 跑，
 * 而端口的 `StreamChunk` 不变量也只规定了 completed 那一格 ——
 * `tool-requested` 那一轮流式该不该吐 text 块，端口没说。
 *
 * 这条测试摁住的是**规则本身**，不依赖某一盘带子那一次的运气：
 * 手写的 SSE 里一定有 thinking_delta，所以分支一定在场。
 *
 * NOTE: 录音带管「真实发生过的事」，手工桩管「规范允许、这次没发生的事」。
 * 两者不互相替代。见 ts-modern-train `docs/experience.md` 第二节。
 */
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { createAnthropicLlm } from "../../src/infra/anthropic/llm.ts";
import { DEEPSEEK_COMPAT } from "../../src/infra/anthropic/providers.ts";

/** 一段按线格式手写的 SSE：一个会流正文的 thinking 块 + 一个 text 块。 */
const SSE = [
  `event: message_start\ndata: {"type":"message_start","message":{"id":"m1","type":"message","role":"assistant","model":"stub","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}`,
  `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}`,
  `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"我先想一想"}}`,
  `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig"}}`,
  `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}`,
  `event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}`,
  `event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"答案是"}}`,
  `event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"二"}}`,
  `event: content_block_stop\ndata: {"type":"content_block_stop","index":1}`,
  `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}`,
  `event: message_stop\ndata: {"type":"message_stop"}`,
].join("\n\n");

const stub = createAnthropicLlm({
  client: new Anthropic({
    baseURL: "https://stub.invalid",
    authToken: "unused",
    maxRetries: 0,
    fetch: () =>
      Promise.resolve(
        new Response(`${SSE}\n\n`, {
          status: 200,
          headers: { "content-type": "text/event-stream; charset=utf-8" },
        }),
      ),
  }),
  model: "stub",
  maxTokens: 64,
  capabilities: DEEPSEEK_COMPAT,
});

const REQ = { system: "", history: [{ role: "user" as const, text: "问" }] };

describe("stream：thinking 的增量不流出去", () => {
  it("text 块只有 text_delta 的内容，思考过程一个字都不进来", async () => {
    const deltas: string[] = [];
    let ended: string | null = null;
    for await (const chunk of stub.stream(REQ)) {
      if (!chunk.ok) throw new Error(`不该有错误：${chunk.error.kind}`);
      if (chunk.value.kind === "text") deltas.push(chunk.value.delta);
      else if (chunk.value.response.kind === "completed")
        ended = chunk.value.response.text;
    }
    // 整体比较：两个 delta 一字不差，而且顺序也是契约的一部分
    expect(deltas).toEqual(["答案是", "二"]);
    // 不变量②：拼起来 === 结尾块的 text（joinText 同样只认 text 块）
    expect(deltas.join("")).toBe(ended);
  });
});
