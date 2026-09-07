/**
 * 映射层的测试：Anthropic 线格式 ↔ 端口语义。
 *
 * 契约在 src/infra/anthropic/map.ts 的 TSDoc 里，决定的候选和代价在
 * docs/decisions/0017-provider-meta.md 和 0018-assistant-turn.md。
 *
 * NOTE: 全程零网络、零 key —— 这就是把翻译和发请求拆开的理由。
 */
import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import {
  toError,
  toMessages,
  toResponse,
} from "../../src/infra/anthropic/map.ts";
import type { LlmRequest } from "../../src/app/ports.ts";

// ══════════════════════════════════════════════════════════════
// 造 Message 的小工具：只填这一组测试关心的字段
// ══════════════════════════════════════════════════════════════

type Blocks = Anthropic.Message["content"];

const text = (t: string): Blocks[number] => ({
  type: "text",
  text: t,
  citations: null,
});

const toolUse = (id: string, name: string, input: unknown): Blocks[number] =>
  ({ type: "tool_use", id, name, input }) as Blocks[number];

function msg(
  stopReason: Anthropic.Message["stop_reason"],
  content: Blocks,
  stopDetails: Anthropic.Message["stop_details"] = null,
): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: stopDetails,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
    },
  } as Anthropic.Message;
}

// ══════════════════════════════════════════════════════════════
// ① toResponse —— 七个 stop_reason 压进八格
// @see docs/decisions/0017-provider-meta.md
// ══════════════════════════════════════════════════════════════

describe("toResponse：stop_reason → kind", () => {
  it("end_turn 且有文本 → completed，文本原样拼起来", () => {
    const r = toResponse(msg("end_turn", [text("你好"), text("世界")]));
    expect(r).toEqual({
      ok: true,
      value: {
        kind: "completed",
        text: "你好世界",
        meta: { stopReason: "end_turn", refusalCategory: null },
      },
    });
  });

  // 起草时定的 A1：「空」由块的有无定义
  it("end_turn 且一个 text 块都没有 → empty", () => {
    const r = toResponse(msg("end_turn", []));
    expect(r.ok && r.value.kind).toBe("empty");
  });

  it("max_tokens → truncated，半句话留在 partialText", () => {
    const r = toResponse(msg("max_tokens", [text("半句")]));
    expect(r).toEqual({
      ok: true,
      value: {
        kind: "truncated",
        partialText: "半句",
        meta: { stopReason: "max_tokens", refusalCategory: null },
      },
    });
  });

  it("model_context_window_exceeded → context-exceeded", () => {
    const r = toResponse(msg("model_context_window_exceeded", [text("半句")]));
    expect(r.ok && r.value.kind).toBe("context-exceeded");
  });

  it("pause_turn → paused", () => {
    const r = toResponse(msg("pause_turn", [text("一半")]));
    expect(r.ok && r.value.kind).toBe("paused");
  });

  it("stop_sequence → stop-sequence", () => {
    const r = toResponse(msg("stop_sequence", [text("到此")]));
    expect(r.ok && r.value.kind).toBe("stop-sequence");
  });

  it("refusal → refused，并把 category 留在 meta 里", () => {
    const r = toResponse(
      msg("refusal", [], {
        type: "refusal",
        category: "cyber",
        explanation: null,
      }),
    );
    expect(r).toEqual({
      ok: true,
      value: {
        kind: "refused",
        meta: { stopReason: "refusal", refusalCategory: "cyber" },
      },
    });
  });

  it("stop_reason 是 null（流式的 message_start）→ malformed，raw 也是 null", () => {
    expect(toResponse(msg(null, [text("x")]))).toEqual({
      ok: false,
      error: { kind: "malformed", raw: null },
    });
  });
});

describe("toResponse：工具调用的收窄", () => {
  it("一个工具 → tool-requested，参数按 name 各自定型", () => {
    const r = toResponse(
      msg("tool_use", [toolUse("t1", "list_files", { dir: "docs" })]),
    );
    expect(r).toEqual({
      ok: true,
      value: {
        kind: "tool-requested",
        calls: [{ name: "list_files", id: "t1", dir: "docs" }],
        meta: { stopReason: "tool_use", refusalCategory: null },
      },
    });
  });

  it("三个工具一次都来 —— 顺序保持不变", () => {
    const r = toResponse(
      msg("tool_use", [
        toolUse("t1", "list_files", { dir: "." }),
        toolUse("t2", "read_file", { path: "a.md" }),
        toolUse("t3", "search", { query: "闭包" }),
      ]),
    );
    expect(r.ok && r.value.kind === "tool-requested" && r.value.calls).toEqual([
      { name: "list_files", id: "t1", dir: "." },
      { name: "read_file", id: "t2", path: "a.md" },
      { name: "search", id: "t3", query: "闭包" },
    ]);
  });

  // 起草时定的 A6
  it("tool_use 同时带 text 块 —— text 直接丢掉", () => {
    const r = toResponse(
      msg("tool_use", [
        text("我来看看"),
        toolUse("t1", "list_files", { dir: "docs" }),
      ]),
    );
    expect(r.ok && r.value).toEqual({
      kind: "tool-requested",
      calls: [{ name: "list_files", id: "t1", dir: "docs" }],
      meta: { stopReason: "tool_use", refusalCategory: null },
    });
  });

  // 起草时定的 A3
  it("说要调工具却一个 tool_use 块都没有 → malformed", () => {
    expect(toResponse(msg("tool_use", [text("我来看看")]))).toEqual({
      ok: false,
      error: { kind: "malformed", raw: "tool_use" },
    });
  });

  it("工具名不在三个之内 → malformed", () => {
    const r = toResponse(
      msg("tool_use", [toolUse("t1", "rm_rf", { dir: "/" })]),
    );
    expect(r.ok).toBe(false);
  });

  it.each([
    { why: "参数缺字段", input: {} },
    { why: "参数类型不对", input: { dir: 42 } },
    { why: "input 根本不是对象", input: "docs" },
  ])("$why → malformed", ({ input }) => {
    const r = toResponse(msg("tool_use", [toolUse("t1", "list_files", input)]));
    expect(r.ok).toBe(false);
  });

  it("多个工具里只要有一个收不进来，整条都 malformed", () => {
    const r = toResponse(
      msg("tool_use", [
        toolUse("t1", "list_files", { dir: "docs" }),
        toolUse("t2", "read_file", {}),
      ]),
    );
    expect(r.ok).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════
// ② toError —— 异常压进四格
// ══════════════════════════════════════════════════════════════

const NOW = 1_000_000;
const now = (): number => NOW;

/** 造一个带状态码和响应头的 APIError。 */
function apiError(
  status: number,
  headers: Record<string, string> = {},
): unknown {
  return new Anthropic.APIError(
    status,
    { type: "error", error: { type: "api_error", message: "x" } },
    "boom",
    new Headers(headers),
  );
}

describe("toError：状态码 → kind", () => {
  it.each([408, 409, 429, 500, 503])("%i → unavailable", (status) => {
    expect(toError(apiError(status), now)).toEqual({
      kind: "unavailable",
      retryAfterMs: null,
    });
  });

  it.each([400, 401, 403, 404, 422])("%i → rejected", (status) => {
    expect(toError(apiError(status), now)).toEqual({ kind: "rejected" });
  });

  it("APIUserAbortError → aborted（是我们自己叫停的，不是故障）", () => {
    expect(toError(new Anthropic.APIUserAbortError(), now)).toEqual({
      kind: "aborted",
    });
  });

  it("连不上 → unavailable，没有供应商的建议", () => {
    const e = new Anthropic.APIConnectionError({ message: "ECONNRESET" });
    expect(toError(e, now)).toEqual({
      kind: "unavailable",
      retryAfterMs: null,
    });
  });

  // 起草时定的 B2
  it("不是 APIError 的异常原样抛出去，不塞进 LlmError", () => {
    const boom = new TypeError("我们自己的 bug");
    expect(() => toError(boom, now)).toThrow(boom);
  });
});

describe("toError：retry-after 的三种格式", () => {
  it("retry-after-ms 是毫秒，原样用", () => {
    expect(toError(apiError(429, { "retry-after-ms": "1500" }), now)).toEqual({
      kind: "unavailable",
      retryAfterMs: 1500,
    });
  });

  it("retry-after 是秒，要乘 1000", () => {
    expect(toError(apiError(429, { "retry-after": "2" }), now)).toEqual({
      kind: "unavailable",
      retryAfterMs: 2000,
    });
  });

  it("retry-after 是 HTTP-date，要减掉注入的当前时间", () => {
    const at = new Date(NOW + 5000).toUTCString();
    expect(toError(apiError(429, { "retry-after": at }), now)).toEqual({
      kind: "unavailable",
      retryAfterMs: 5000,
    });
  });

  it("HTTP-date 已经过去了 → 夹成 0，不给负数", () => {
    const at = new Date(NOW - 90_000).toUTCString();
    const e = toError(apiError(429, { "retry-after": at }), now);
    expect(e).toEqual({ kind: "unavailable", retryAfterMs: 0 });
  });

  it("一个头都没有 → null", () => {
    expect(toError(apiError(429), now)).toEqual({
      kind: "unavailable",
      retryAfterMs: null,
    });
  });
});

// 起草时定的 B3
describe("toError：x-should-retry 推翻状态码", () => {
  it("429 但服务器说别重试 → rejected", () => {
    expect(toError(apiError(429, { "x-should-retry": "false" }), now)).toEqual({
      kind: "rejected",
    });
  });

  it("400 但服务器说要重试 → unavailable", () => {
    expect(toError(apiError(400, { "x-should-retry": "true" }), now)).toEqual({
      kind: "unavailable",
      retryAfterMs: null,
    });
  });
});

// ══════════════════════════════════════════════════════════════
// ③ toMessages —— 端口的历史排成线格式
// @see docs/decisions/0018-assistant-turn.md
// ══════════════════════════════════════════════════════════════

const req = (history: LlmRequest["history"]): LlmRequest => ({
  system: "你是助手",
  history,
});

const okContent = (content: string) => ({ kind: "ok" as const, content });

describe("toMessages：形状", () => {
  it("system 单独一格，不进 messages", () => {
    const r = toMessages(req([{ role: "user", text: "你好" }]));
    expect(r).toEqual({
      ok: true,
      value: {
        system: "你是助手",
        messages: [{ role: "user", content: "你好" }],
      },
    });
  });

  it("assistant 轮还原成 tool_use 块，参数按 name 放", () => {
    const r = toMessages(
      req([
        { role: "user", text: "docs 下有什么" },
        {
          role: "assistant",
          calls: [{ name: "list_files", id: "t1", dir: "docs" }],
        },
        { role: "tool-result", id: "t1", outcome: okContent("README.md") },
      ]),
    );
    expect(r.ok && r.value.messages).toEqual([
      { role: "user", content: "docs 下有什么" },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "list_files",
            input: { dir: "docs" },
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "README.md" },
        ],
      },
    ]);
  });

  it.each([
    { name: "read_file" as const, id: "t1", path: "a.md" },
    { name: "search" as const, id: "t2", query: "闭包" },
  ])("$name 的参数进 input", (call) => {
    const r = toMessages(
      req([
        { role: "user", text: "q" },
        { role: "assistant", calls: [call] },
      ]),
    );
    const assistant = r.ok ? r.value.messages[1] : undefined;
    expect(assistant).toEqual({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: call.id,
          name: call.name,
          input:
            call.name === "read_file" ? { path: "a.md" } : { query: "闭包" },
        },
      ],
    });
  });
});

// 这一条是本模块最贵的不变量：拆开不报错、不返回 400，只会让模型
// 慢慢不再并发调用工具。见 ts-modern-train docs/libraries/anthropic-sdk.md 坑 6。
describe("toMessages：并发工具结果必须合并成一条 user 消息", () => {
  it("三个工具结果 → 一条消息、三个块", () => {
    const r = toMessages(
      req([
        { role: "user", text: "q" },
        {
          role: "assistant",
          calls: [
            { name: "list_files", id: "t1", dir: "." },
            { name: "read_file", id: "t2", path: "a.md" },
            { name: "search", id: "t3", query: "x" },
          ],
        },
        { role: "tool-result", id: "t1", outcome: okContent("A") },
        { role: "tool-result", id: "t2", outcome: okContent("B") },
        { role: "tool-result", id: "t3", outcome: okContent("C") },
      ]),
    );
    const msgs = r.ok ? r.value.messages : [];
    expect(msgs).toHaveLength(3);
    expect(msgs[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t1", content: "A" },
        { type: "tool_result", tool_use_id: "t2", content: "B" },
        { type: "tool_result", tool_use_id: "t3", content: "C" },
      ],
    });
  });

  it("两轮工具各自合并，不会串到一起", () => {
    const r = toMessages(
      req([
        { role: "user", text: "q" },
        {
          role: "assistant",
          calls: [{ name: "list_files", id: "t1", dir: "." }],
        },
        { role: "tool-result", id: "t1", outcome: okContent("A") },
        {
          role: "assistant",
          calls: [{ name: "read_file", id: "t2", path: "a" }],
        },
        { role: "tool-result", id: "t2", outcome: okContent("B") },
      ]),
    );
    expect(r.ok && r.value.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
  });
});

describe("toMessages：非法历史 → malformed", () => {
  it("空历史", () => {
    expect(toMessages(req([]))).toEqual({
      ok: false,
      error: { kind: "malformed", raw: null },
    });
  });

  it("第一条不是 user", () => {
    const r = toMessages(
      req([
        {
          role: "assistant",
          calls: [{ name: "search", id: "t1", query: "x" }],
        },
      ]),
    );
    expect(r.ok).toBe(false);
  });

  it("工具结果前面没有 assistant 轮", () => {
    const r = toMessages(
      req([
        { role: "user", text: "q" },
        { role: "tool-result", id: "t1", outcome: okContent("A") },
      ]),
    );
    expect(r.ok).toBe(false);
  });
});
