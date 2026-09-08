/**
 * SSE 的编码器 —— 把一个事件变成一段合法的字节。
 *
 * @remarks
 * 这一层只做一件事，但它是整个 HTTP 边界里最容易出安全事故的地方。
 *
 * SAFETY: 载荷一律走 `JSON.stringify`，绝不把模型输出直接拼在 `data:` 后面。
 * 模型输出里可以出现任意字符，而模型读的是仓库里的文件 —— 文件内容是外部输入。
 * 一个换行就能把事件截断（后半截不含冒号，接收方按规范当未知字段丢掉），
 * 一个 `\n\ndata: ` 就能**伪造出一个我们从没发过的事件**。同 CRLF 注入那一类。
 * `JSON.stringify` 把 U+0000–U+001F 全部转义，所以结果里不可能出现裸换行。
 *
 * 实测输出见 ts-modern-train `docs/libraries/node-http-sse.md` 坑①。
 *
 * @see docs/decisions/0021-http-boundary-and-sse.md
 */
import type { WireEvent } from "./wire.ts";

/**
 * SSE 响应必须带的头。
 *
 * NOTE: 没有 content-length —— 长度本来就不知道，Node 会自己加
 * `transfer-encoding: chunked`。`x-accel-buffering` 是给 nginx 那类反代看的：
 * 不关掉缓冲，它会攒够一块再发，逐块输出就没了。
 */
export const SSE_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

/**
 * 把一个线格式事件编码成 SSE 的一段。
 *
 * @param e - 要发的事件
 * @returns 可以直接 `res.write` 的字符串，结尾自带空行
 *
 * @example
 * ```ts
 * res.write(encode({ event: "delta", data: { text: "第一行\n第二行" } }));
 * // event: delta\ndata: {"text":"第一行\\n第二行"}\n\n
 * ```
 */
export function encode(e: WireEvent): string {
  return `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
}

/**
 * 心跳。
 *
 * @remarks
 * NOTE: `:` 开头的行按规范被接收方丢弃，它唯一的作用是让这条 TCP 连接
 * 在代理眼里不像空闲的。看起来没用的东西，删掉之后长对话会被中间设备掐断。
 *
 * @returns 一行 SSE 注释
 */
export function heartbeat(): string {
  return ": ping\n\n";
}
