/**
 * HTTP 边界 —— 两个端点，一个用例层（ADR 0021 D1）。
 *
 * @remarks
 * 这一层的职责就三件，多一件都不该有：
 *
 * ```text
 * ① 把 HTTP 的东西翻译成用例层的词汇   req/res 到此为止（D4）
 * ② 把用例层的事件翻译成线格式         wire.ts + sse.ts
 * ③ 把「客户端走了」翻译成取消         这根线不接，账单就继续跑
 * ```
 *
 * IMPORTANT: `run` 不认识 `req`/`res`，这不是洁癖 —— 它是「node:http 换 Hono」
 * 这道双向门的前提（roadmap 决策清单）。用例层的测试也因此不用造 http 对象。
 *
 * @see docs/decisions/0021-http-boundary-and-sse.md
 */
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { z } from "zod";
import type { Deps, RunResult } from "../../app/runTurn.ts";
import { collect, run } from "../../app/runTurn.ts";
import type { ValidRunConfig } from "../../app/config.ts";
import { SSE_HEADERS, encode, heartbeat } from "./sse.ts";
import { write } from "./write.ts";
import { toTerminal, toWire } from "./wire.ts";

/** 起一个服务要什么。IMPORTANT: 全部显式传入 —— 这里不读环境变量。 */
export type ChatServerDeps = {
  readonly deps: Deps;
  readonly cfg: ValidRunConfig;
  readonly systemPrompt: string;
  /**
   * 整条请求的寿命上限。
   *
   * IMPORTANT: Node 自己没有这个上限 —— `server.requestTimeout` 量的是
   * 「收完请求」，掐不到已经开始的响应（实测，见 ts-modern-train
   * docs/libraries/node-http-sse.md 坑⑦）。不设就是没有。
   */
  readonly requestTimeoutMs: number;
  /**
   * 多久发一次心跳。
   *
   * NOTE: 可配置不是为了给运维一个旋钮，是为了**能测** —— 默认 15 秒的话
   * 测试要么等 15 秒要么假装时间，两条都比传一个数贵。
   */
  readonly heartbeatMs?: number;
};

/** 心跳的默认间隔。代理掐空闲连接通常在 30–60 秒，留一半余量。 */
const HEARTBEAT_MS = 15000;

/**
 * 客户端会看到的错误码。
 *
 * SAFETY: 闭集，而且只有码没有细节 —— provider 的原话、路径、key
 * 一个字都不许出现在响应体里（CLAUDE.md 第④类字符串）。
 */
type ErrorCode =
  | "not-found"
  | "method-not-allowed"
  | "bad-json"
  | "invalid-body"
  | "too-large"
  | "input-rejected"
  | "upstream-unavailable"
  | "upstream-rejected"
  | "upstream-malformed"
  | "timeout";

/** 请求体。NOTE: 用 Zod 是因为这里是进程边界，形状没有被 tsc 保证过。 */
const Body = z.object({ question: z.string().min(1) });

/**
 * 穷尽性守卫。
 *
 * NOTE: 没有它 tsc 也会拦（TS2366「函数缺少 return」），但那句话指着函数签名，
 * 不说少了哪一格；有它是 TS2345，把新 kind 的名字念出来。2026-09-08 两种都实测过。
 */
/* v8 ignore start -- 按定义不可达：能走到这里说明类型检查已经失败了 */
function assertNever(x: never): never {
  throw new Error(`http.unmapped-error: ${JSON.stringify(x)}`);
}
/* v8 ignore stop */

/**
 * 端口错误 → 状态码 + 码。
 *
 * @remarks
 * IMPORTANT: 判据是 **`retryAfterMs` 这个字段**，不是「哪个码更常见」——
 * `unavailable` 是四格里唯一带重试建议的，而 `Retry-After` 的定义挂在 503 上；
 * `rejected`（401/403/请求本身不合法）重试没用，说 503 等于叫客户端白等一轮。
 * 两个码调过来，语义正好互换，而且**没有任何别的信号会红**（四格都在，只是值错）。
 */
function mapError(r: Extract<RunResult, { kind: "failed" }>): {
  readonly status: number;
  readonly code: ErrorCode;
} {
  switch (r.error.kind) {
    case "unavailable":
      return { status: 503, code: "upstream-unavailable" };
    case "rejected":
      return { status: 502, code: "upstream-rejected" };
    case "malformed":
      return { status: 502, code: "upstream-malformed" };
    // 还有人在听的取消只可能是我们自己的请求超时 —— 客户端走了的话
    // 这个响应根本发不出去（socket 已经没了）。
    case "aborted":
      return { status: 504, code: "timeout" };
    default:
      return assertNever(r.error);
  }
}

/** 回一个 JSON。NOTE: 头还没发出去时才能用它，这是不变量①的直接后果。 */
function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(text)),
  });
  res.end(text);
}

/**
 * 收请求体，超过上限就停。上限沿用领域已有的那个数，不另发明一个。
 *
 * IMPORTANT: 边界方向要和领域一致 —— `domain/input.ts` 判的是
 * `bytes <= max`，所以**正好等于上限是放行**，这里必须是 `>` 不是 `>=`。
 * 同一个数在两处用相反的方向，压线的请求就会被这一层挡掉而领域根本不知道。
 */
async function readBody(
  req: IncomingMessage,
  limit: number,
): Promise<
  { readonly ok: true; readonly text: string } | { readonly ok: false }
> {
  let size = 0;
  const parts: Buffer[] = [];
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.byteLength;
    if (size > limit) return { ok: false };
    parts.push(buf);
  }
  return { ok: true, text: Buffer.concat(parts).toString("utf8") };
}

/**
 * 一次请求用的取消信号：客户端走了，或者整条请求超时了。
 *
 * IMPORTANT: 每个请求造一套。共享 controller 的话，一个人断开会连坐所有人，
 * 而且之后的新请求全部秒失败（实测，坑⑩）。
 */
function cancellation(
  res: ServerResponse,
  requestTimeoutMs: number,
): AbortSignal {
  const clientGone = new AbortController();
  res.on("close", () => {
    clientGone.abort(new Error("client-gone"));
  });
  return AbortSignal.any([
    clientGone.signal,
    AbortSignal.timeout(requestTimeoutMs),
  ]);
}

/** 流式：一边跑一边转发。头拖到第一个事件才发，为的是 setup 错误还能回 400。 */
async function streamChat(
  d: ChatServerDeps,
  res: ServerResponse,
  question: string,
): Promise<void> {
  const gen = run(d.deps, d.cfg, d.systemPrompt, question, {
    signal: cancellation(res, d.requestTimeoutMs),
  });

  let started = false;
  let beat: NodeJS.Timeout | undefined;
  // IMPORTANT: 客户端走了要停心跳，否则这个 interval 会一直写一个死了的 res。
  res.on("close", () => {
    clearInterval(beat);
  });

  for (;;) {
    const step = await gen.next();

    if (!step.done) {
      if (!started) {
        res.writeHead(200, SSE_HEADERS);
        // 头先发出去，客户端立刻知道自己连上了 —— 实测差 338ms（坑⑥）
        res.flushHeaders();
        beat = setInterval(() => {
          res.write(heartbeat());
        }, d.heartbeatMs ?? HEARTBEAT_MS);
        started = true;
      }
      await write(res, encode(toWire(step.value)));
      continue;
    }

    clearInterval(beat);
    const terminal = toTerminal(step.value);
    if (terminal !== null) {
      await write(res, encode(terminal));
      res.end();
      return;
    }

    // 到这里只剩 failed 和 setup 两种结局
    if (!started) {
      const body =
        step.value.kind === "setup"
          ? { status: 400, code: "input-rejected" as ErrorCode }
          : mapError(step.value as Extract<RunResult, { kind: "failed" }>);
      json(res, body.status, { code: body.code });
      return;
    }
    // 头已经是 200 了，改不成状态码 —— 掐掉 socket（D2）。
    // IMPORTANT: 这条路径下客户端看到的是传输层错误，和真崩溃同形。
    //            成功路径必须发终止事件，否则「说完了」和「断了」也分不开。
    res.destroy();
    return;
  }
}

/** 非流式：同一个用例层，只是把事件收完再回一次 JSON（D1）。 */
async function syncChat(
  d: ChatServerDeps,
  res: ServerResponse,
  question: string,
): Promise<void> {
  const { result } = await collect(
    run(d.deps, d.cfg, d.systemPrompt, question, {
      signal: cancellation(res, d.requestTimeoutMs),
    }),
  );

  if (result.kind === "setup") {
    json(res, 400, { code: "input-rejected" });
    return;
  }
  if (result.kind === "failed") {
    const { status, code } = mapError(result);
    json(res, status, { code });
    return;
  }
  const budget = {
    modelCalls: result.budget.modelCalls,
    toolRuns: result.budget.toolRuns,
    inputBytes: result.budget.inputBytes,
  };
  json(
    res,
    200,
    result.kind === "done"
      ? { stop: "done", text: result.text, budget }
      : { stop: "aborted", reason: result.reason.kind, budget },
  );
}

/**
 * 造一个 chat 服务。
 *
 * @param d - 用例层的依赖、配置、系统提示词、请求寿命上限
 * @returns 还没 listen 的 `http.Server`
 *
 * @example
 * ```ts
 * const server = createChatServer({ deps, cfg, systemPrompt, requestTimeoutMs });
 * server.listen(3000);
 * ```
 */
export function createChatServer(d: ChatServerDeps): Server {
  return createServer((req, res) => {
    void handle(d, req, res);
  });
}

/** 路由 + 请求体校验。IMPORTANT: 这里的失败都发生在头出去之前，所以能用状态码。 */
async function handle(
  d: ChatServerDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const path = (req.url ?? "").split("?")[0];
  if (path !== "/chat" && path !== "/chat/sync") {
    json(res, 404, { code: "not-found" satisfies ErrorCode });
    return;
  }
  if (req.method !== "POST") {
    json(res, 405, { code: "method-not-allowed" satisfies ErrorCode });
    return;
  }

  const raw = await readBody(req, d.cfg.limits.maxInputBytesTotal);
  if (!raw.ok) {
    json(res, 413, { code: "too-large" satisfies ErrorCode });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.text);
  } catch {
    json(res, 400, { code: "bad-json" satisfies ErrorCode });
    return;
  }

  const body = Body.safeParse(parsed);
  if (!body.success) {
    json(res, 400, { code: "invalid-body" satisfies ErrorCode });
    return;
  }

  await (path === "/chat"
    ? streamChat(d, res, body.data.question)
    : syncChat(d, res, body.data.question));
}
