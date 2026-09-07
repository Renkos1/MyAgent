/**
 * 录和放 —— 接缝本身。ADR 0012 的 ①②⑦ 落地。
 *
 * @remarks
 * IMPORTANT: 接缝定在 **HTTP 响应体**，不在 LlmPort 上。
 * 定在端口上的话 ReplayLlm 会顶替掉整个适配器，而适配器正是回放要测的东西 ——
 * 那时适配器的覆盖率是 0，不是「低」。
 *
 * NOTE: 这个文件不碰 fs。文件格式和读写在 `cassette.ts`。
 *
 * @see docs/decisions/0012-replay-cassette-format.md
 */
import type { Cassette, Exchange } from "./cassette.ts";
import { keepHeaders } from "./cassette.ts";

/**
 * 适配器对 HTTP 的全部要求。
 *
 * @remarks
 * 形状和全局 `fetch` 兼容（`fetch` 收的 input 更宽，所以赋得进来）。
 * TRAP: 只支持 `string | URL`，不支持传一个 `Request` 对象 ——
 * 那种调用方式取不到 body 而不报错。阶段 4 验 SDK 时要一起验这一条。
 */
export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * 把 init 里的 body 压成字符串。
 *
 * TRAP: 非字符串体（Uint8Array / FormData / 流）当场抛，不静默变 null ——
 * 变 null 的话两个内容不同的请求会算出同一个指纹，
 * 于是「带子对不上」这道安全带就悄悄失效了。
 */
function bodyOf(init: RequestInit | undefined): string | null {
  const b = init?.body;
  if (b === undefined || b === null) return null;
  if (typeof b === "string") return b;
  throw new Error(
    "cassette.unsupported-body: 只支持字符串 body（ADR 0012 §② 的已知限制）——" +
      "收到的是别的形状，接真适配器时要先解决这一条。",
  );
}

/**
 * 一次请求的指纹：ADR 0012 §⑦ 拿它判「带子还配不配得上现在的代码」。
 */
function fingerprint(method: string, url: string, body: string | null): string {
  return `${method.toUpperCase()} ${url}\n${body ?? "(无 body)"}`;
}

/**
 * 拿一盘带子当 fetch 用。
 *
 * @remarks
 * IMPORTANT: 带子里的往返按顺序取，但每一次都核对请求指纹 ——
 * 顺序本身很脆（插一个请求后面全错位），核对指纹才是安全带。
 * 对不上就当场红，而且把两边都打出来（ADR 0012 §⑦）。
 *
 * TRAP: 失败走 **rejected promise**，不是同步 throw。真 fetch 不会同步抛，
 * 同步抛的替身会让调用方的 `.catch()` 漏掉这个错误 ——
 * 而那正是「Fake 比真货行为不同」的典型形态。
 *
 * @param c - 录好的带子
 * @returns 一个只吃这盘带子的 fetch
 */
export function replaying(c: Cassette): FetchLike {
  let next = 0;
  return (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const mine = fingerprint(method, url, bodyOf(init));

    const ex: Exchange | undefined = c.exchanges[next];
    if (ex === undefined) {
      return Promise.reject(
        new Error(
          `录音带 ${c.provider}/${c.name} 只有 ${String(c.exchanges.length)} 次往返，` +
            `第 ${String(next + 1)} 次请求没得给：\n${mine}`,
        ),
      );
    }
    next += 1;

    const theirs = fingerprint(
      ex.request.method,
      ex.request.url,
      ex.request.body,
    );
    if (mine !== theirs) {
      return Promise.reject(
        new Error(
          `录音带 ${c.provider}/${c.name} 第 ${String(next)} 次对不上 ——` +
            `带子录于 ${c.recordedAt}，多半是代码改了该重录了。\n` +
            `现在发的：\n${mine}\n带子里的：\n${theirs}`,
        ),
      );
    }

    return Promise.resolve(
      new Response(ex.response.body, {
        status: ex.response.status,
        headers: { ...ex.response.headers },
      }),
    );
  };
}

/** 录制时要填的元信息。 */
export type RecordMeta = Omit<Cassette, "exchanges">;

/**
 * 包一层真 fetch，边打边录。
 *
 * @remarks
 * SAFETY: header 在这里就按白名单筛掉了 —— 抹在写盘前，不是读盘时。
 * 读盘时抹意味着明文在磁盘上存在过。
 *
 * NOTE: 响应体读一次就没了，所以这里 clone 之后再读。
 *
 * @param upstream - 真正去打网络的那个 fetch
 * @param meta - 带子的元信息
 * @returns 包好的 fetch，和一个「把录到的东西收成一盘带子」的函数
 */
export function recording(
  upstream: FetchLike,
  meta: RecordMeta,
): { readonly fetch: FetchLike; readonly cassette: () => Cassette } {
  const exchanges: Exchange[] = [];
  const wrapped: FetchLike = async (input, init) => {
    // IMPORTANT: 先验 body 形状再打网络 —— 反过来的话会花掉一次真调用
    //            才发现录不下来，而录制正是要花钱的那一步。
    const body = bodyOf(init);
    const res = await upstream(input, init);
    const copy = res.clone();
    exchanges.push({
      request: {
        method: (init?.method ?? "GET").toUpperCase(),
        url: String(input),
        headers: keepHeaders(new Headers(init?.headers).entries()),
        body,
      },
      response: {
        status: copy.status,
        headers: keepHeaders(copy.headers.entries()),
        body: await copy.text(),
      },
    });
    return res;
  };
  return { fetch: wrapped, cassette: () => ({ ...meta, exchanges }) };
}
