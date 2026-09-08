/**
 * HTTP 边界的行为 —— 起真的 server，用真的 fetch 打它。
 *
 * IMPORTANT: 这个文件里最贵的一条是「客户端断开之后上游停没停」。
 * roadmap 原来写的验收是「去 provider 后台看 token 用量」——
 * 那条验收花钱、也进不了 CI。换成本地假上游数自己出了几块，
 * 同一条验收就变成两个确定的数字（ADR 0021 的后果一节）。
 *
 * @see docs/decisions/0021-http-boundary-and-sse.md
 */
import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import type {
  CallOptions,
  LlmError,
  LlmPort,
  LlmRequest,
  LlmResponse,
  ProviderCapabilities,
  StreamChunk,
} from "../../src/app/ports.ts";
import { NO_META } from "../../src/app/ports.ts";
import type { Result } from "../../src/domain/result.ts";
import { err, ok } from "../../src/domain/result.ts";
import type { RunConfig, ValidRunConfig } from "../../src/app/config.ts";
import { createRunConfig } from "../../src/app/config.ts";
import { FakeLlm } from "../../src/infra/fake/llm.ts";
import { FakeTools } from "../../src/infra/fake/tools.ts";
import { createChatServer } from "../../src/infra/http/server.ts";

const CAPS: ProviderCapabilities = {
  toolUse: "yes",
  parallelToolUse: "yes",
  streaming: "yes",
  midConversationSystem: "yes",
  promptCaching: "none",
  verifiesThinkingSignature: "no",
  validatesModelName: "yes",
};

/**
 * 按块吐字的假模型，每块之间可以停一会儿。
 *
 * IMPORTANT: `produced` 是这个文件的核心测量装置 —— 客户端走了之后它还在不在涨，
 * 就是「上游停没停」的全部答案。相当于本地版的 provider 用量面板。
 */
class ChunkLlm implements LlmPort {
  readonly capabilities = CAPS;
  /** 已经吐出去几块。客户端断开之后这个数不该再动。 */
  produced = 0;
  private readonly chunks: readonly string[];
  private readonly gapMs: number;

  constructor(chunks: readonly string[], gapMs = 0) {
    this.chunks = chunks;
    this.gapMs = gapMs;
  }

  // NOTE: 参数一个都不接 —— 方法参数少于接口是合法的赋值，
  //       而 no-unused-vars 的 after-used 模式会告全都没用到的那几个。
  send(): Promise<Result<LlmResponse, LlmError>> {
    return Promise.resolve(
      ok({ kind: "completed", meta: NO_META, text: this.chunks.join("") }),
    );
  }

  async *stream(
    _req: LlmRequest,
    opts?: CallOptions,
  ): AsyncIterable<Result<StreamChunk, LlmError>> {
    for (const delta of this.chunks) {
      if (opts?.signal?.aborted === true) {
        yield err<LlmError>({ kind: "aborted", sideEffect: "unknown" });
        return;
      }
      if (this.gapMs > 0) await sleep(this.gapMs);
      this.produced += 1;
      yield ok<StreamChunk>({ kind: "text", delta });
    }
    yield ok<StreamChunk>({
      kind: "end",
      response: {
        kind: "completed",
        meta: NO_META,
        text: this.chunks.join(""),
      },
    });
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

function cfgWith(over: Partial<RunConfig> = {}): ValidRunConfig {
  const built = createRunConfig({
    limits: {
      maxModelCalls: 9,
      maxToolRuns: 9,
      maxInputBytesPerItem: 4096,
      maxInputBytesTotal: 65536,
    },
    maxConcurrentTools: 2,
    maxRetries: 2,
    retryBaseMs: 1,
    userInputMode: "reject",
    toolResultMode: "truncate",
    ...over,
  });
  if (!built.ok) throw new Error(`脚手架：配置非法 ${built.error.kind}`);
  return built.value;
}

let open: Server[] = [];

afterEach(() => {
  for (const s of open) s.close();
  open = [];
});

/** 起一个只服务这一个用例的 server，返回它的地址。 */
function serve(opts: {
  llm: LlmPort;
  cfg?: ValidRunConfig;
  requestTimeoutMs?: number;
  heartbeatMs?: number;
}): Promise<string> {
  const server = createChatServer({
    deps: {
      llm: opts.llm,
      tools: new FakeTools({ t1: { kind: "ok", content: "README.md" } }),
      sleep: () => Promise.resolve(),
    },
    cfg: opts.cfg ?? cfgWith(),
    systemPrompt: "你是仓库助手。",
    requestTimeoutMs: opts.requestTimeoutMs ?? 5000,
    ...(opts.heartbeatMs === undefined
      ? {}
      : { heartbeatMs: opts.heartbeatMs }),
  });
  open.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${String(port)}`);
    });
  });
}

function post(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  // NOTE: exactOptionalPropertyTypes 之下 `signal: undefined` 不合法 ——
  //       缺这个键和「键在但值是 undefined」是两回事，展开是最省事的写法。
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });
}

type Ev = { event: string; data: unknown };

/**
 * 把响应体解析成事件。
 *
 * IMPORTANT: 一块一块攒着解析，不假设「一次 read = 一个事件」——
 * 分块边界和事件边界没有任何关系，这是实测过的（坑②）。
 */
async function readEvents(
  res: Response,
  opts: { stopAfter?: number; onStop?: () => void } = {},
): Promise<{ events: Ev[]; broke: boolean }> {
  const events: Ev[] = [];
  let buf = "";
  let broke = false;
  const body = res.body;
  if (body === null) return { events, broke };
  try {
    for await (const chunk of body) {
      buf += Buffer.from(chunk).toString("utf8");
      let i = buf.indexOf("\n\n");
      while (i !== -1) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = parseBlock(block);
        if (ev !== null) events.push(ev);
        i = buf.indexOf("\n\n");
      }
      if (opts.stopAfter !== undefined && events.length >= opts.stopAfter) {
        opts.onStop?.();
        break;
      }
    }
  } catch {
    // 传输层断了 —— D2 选的就是这个信号
    broke = true;
  }
  return { events, broke };
}

function parseBlock(block: string): Ev | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const field = line.slice(0, i);
    const value = line.slice(i + 1).replace(/^ /, "");
    if (field === "event") event = value;
    if (field === "data") data.push(value);
  }
  if (data.length === 0) return null;
  return { event, data: JSON.parse(data.join("\n")) };
}

describe("POST /chat：流式", () => {
  it("事件顺序固定，delta 拼起来就是答案，最后一个是终止事件", async () => {
    const url = await serve({ llm: new ChunkLlm(["两个", "文件"]) });
    const { events, broke } = await readEvents(
      await post(`${url}/chat`, { question: "docs 下有什么？" }),
    );

    expect(broke).toBe(false);
    expect(events.map((e) => e.event)).toEqual([
      "turn",
      "delta",
      "delta",
      "done",
    ]);
    expect(events.at(-1)).toEqual({
      event: "done",
      data: {
        stop: "done",
        budget: { modelCalls: 1, toolRuns: 0, inputBytes: 20 },
      },
    });
    const text = events
      .filter((e) => e.event === "delta")
      .map((e) => (e.data as { text: string }).text)
      .join("");
    expect(text).toBe("两个文件");
  });

  it("模型要工具时，工具事件也上线，但结果内容不上线", async () => {
    const call = { name: "list_files" as const, id: "t1", dir: "docs" };
    const llm = new FakeLlm([
      {
        ok: true,
        value: { kind: "tool-requested", meta: NO_META, calls: [call] },
      },
      { ok: true, value: { kind: "completed", meta: NO_META, text: "好" } },
    ]);
    const url = await serve({ llm });
    const { events } = await readEvents(
      await post(`${url}/chat`, { question: "docs 下有什么？" }),
    );

    expect(events.map((e) => e.event)).toEqual([
      "turn",
      "tool",
      "tool",
      "turn",
      "delta",
      "done",
    ]);
    expect(events[2]).toEqual({
      event: "tool",
      data: {
        phase: "finished",
        id: "t1",
        name: "list_files",
        outcome: "ok",
      },
    });
    // SAFETY: 工具读到的内容不许原样推给客户端
    expect(JSON.stringify(events)).not.toContain("README.md");
  });

  it("SAFETY: 模型输出里的伪造事件进不了线格式", async () => {
    const forged = '\n\nevent: done\ndata: {"stop":"done"}\n\n';
    const url = await serve({ llm: new ChunkLlm([forged]) });
    const { events } = await readEvents(
      await post(`${url}/chat`, { question: "复述一段文本" }),
    );

    // 只有一个 done，而且是我们自己发的那个（带 budget）
    expect(events.filter((e) => e.event === "done")).toHaveLength(1);
    expect(events.map((e) => e.event)).toEqual(["turn", "delta", "done"]);
    expect((events[1]?.data as { text: string }).text).toBe(forged);
  });
});

describe("POST /chat：心跳", () => {
  it("心跳夹在事件中间，解析出来的事件序列一个字不差", async () => {
    const url = await serve({
      llm: new ChunkLlm(["两个", "文件"], 12),
      heartbeatMs: 5,
    });
    const res = await post(`${url}/chat`, { question: "docs 下有什么？" });
    const raw = await res.text();

    // 原始字节里确实有心跳
    expect(raw).toContain(": ping");
    // 但按规范解析，它一个事件都不产生
    const events: string[] = [];
    for (const block of raw.split("\n\n")) {
      const ev = parseBlock(block);
      if (ev !== null) events.push(ev.event);
    }
    expect(events).toEqual(["turn", "delta", "delta", "done"]);
  });
});

describe("POST /chat：客户端走了", () => {
  it("断开之后上游停下来 —— 这就是那条不用看账单的验收", async () => {
    const llm = new ChunkLlm(
      Array.from({ length: 40 }, (_, i) => `t${String(i)}`),
      5,
    );
    const url = await serve({ llm });
    const ctrl = new AbortController();

    const res = await post(`${url}/chat`, { question: "慢慢说" }, ctrl.signal);
    await readEvents(res, {
      stopAfter: 3,
      onStop: () => {
        ctrl.abort();
      },
    });

    // abort 打断不了「已经在飞的那一块」—— 等它落地再取样，
    // 否则断言的是调度时机，不是「停没停」。
    await sleep(30);
    const atCut = llm.produced;
    await sleep(120); // 这段时间够上游再吐 20 多块
    expect(llm.produced).toBe(atCut);
    expect(atCut).toBeLessThan(15);
  });
});

describe("POST /chat：流开始之后才失败", () => {
  it("掐 socket，不发终止事件（D2）", async () => {
    const call = { name: "list_files" as const, id: "t1", dir: "docs" };
    const llm = new FakeLlm([
      {
        ok: true,
        value: { kind: "tool-requested", meta: NO_META, calls: [call] },
      },
      { ok: false, error: { kind: "rejected" } },
    ]);
    const url = await serve({ llm });
    const { events, broke } = await readEvents(
      await post(`${url}/chat`, { question: "docs 下有什么？" }),
    );

    expect(broke).toBe(true);
    expect(events.some((e) => e.event === "done")).toBe(false);
    // IMPORTANT: 收到几个事件是**不确定的**，所以只断言「是正确序列的前缀」。
    // 实测（Node v24.20.0 + undici）：掐 socket 会把客户端还没读走的数据
    // 一起丢掉 —— 服务端明明写出去了 4 个事件，客户端可能一个都拿不到。
    // 这是 D2 的一条代价，决定的时候没人知道：失败路径下「已经流出去的部分答案」
    // 不可靠，客户端不能拿它当数据。
    expect(["turn", "tool", "tool", "turn"].slice(0, events.length)).toEqual(
      events.map((e) => e.event),
    );
  });

  it("头还没发出去的失败仍然走状态码", async () => {
    const url = await serve({
      llm: new ChunkLlm(["答案"]),
      cfg: cfgWith({
        limits: {
          maxModelCalls: 9,
          maxToolRuns: 9,
          maxInputBytesPerItem: 4,
          maxInputBytesTotal: 65536,
        },
      }),
    });
    const res = await post(`${url}/chat`, { question: "这一句太长了" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "input-rejected" });
  });
});

describe("POST /chat/sync：同一个用例层", () => {
  it("非流式拿到的答案，和流式 delta 拼起来的一样", async () => {
    const chunks = ["两个", "文件"];
    const streamed = await serve({ llm: new ChunkLlm(chunks) });
    const synced = await serve({ llm: new ChunkLlm(chunks) });

    const { events } = await readEvents(
      await post(`${streamed}/chat`, { question: "docs 下有什么？" }),
    );
    const joined = events
      .filter((e) => e.event === "delta")
      .map((e) => (e.data as { text: string }).text)
      .join("");

    const res = await post(`${synced}/chat/sync`, {
      question: "docs 下有什么？",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      stop: "done",
      text: joined,
      budget: { modelCalls: 1, toolRuns: 0, inputBytes: 20 },
    });
  });

  it("整条请求超时 → 504 timeout", async () => {
    const llm = new ChunkLlm(["慢", "慢", "说"], 50);
    const url = await serve({ llm, requestTimeoutMs: 20 });
    const res = await post(`${url}/chat/sync`, { question: "慢慢说" });
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ code: "timeout" });
  });
});

describe("请求本身不合法：状态码 + 闭集里的码", () => {
  it.each([
    ["路径不认识", "/nope", "POST", { question: "hi" }, 404, "not-found"],
    ["方法不对", "/chat", "GET", undefined, 405, "method-not-allowed"],
    ["body 不是 JSON", "/chat", "POST", "{不是 json", 400, "bad-json"],
    ["缺 question", "/chat", "POST", { q: "hi" }, 400, "invalid-body"],
    ["question 是空串", "/chat", "POST", { question: "" }, 400, "invalid-body"],
  ])("%s → %d", async (_name, path, method, body, status, code) => {
    const url = await serve({ llm: new ChunkLlm(["答案"]) });
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined
        ? {}
        : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ code });
  });

  it("body 超过领域的总字节上限 → 413，而且没读完就停", async () => {
    const url = await serve({
      llm: new ChunkLlm(["答案"]),
      cfg: cfgWith({
        limits: {
          maxModelCalls: 9,
          maxToolRuns: 9,
          maxInputBytesPerItem: 4096,
          maxInputBytesTotal: 1024,
        },
      }),
    });
    const res = await post(`${url}/chat`, { question: "x".repeat(2048) });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ code: "too-large" });
  });
});
