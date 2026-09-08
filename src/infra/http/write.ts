/**
 * 往响应流里写一块，缓冲满了就等它排空。
 *
 * @remarks
 * 单独成一个模块，是因为它的契约有一条**看不见的第二腿**：客户端断开之后
 * `write` 返回 false 且不抛，而 `drain` 永远不会再来 —— 只等 drain 的实现
 * 会在这里挂死，且挂死的表现是「什么都没发生」，从外面看和正常等待一样。
 *
 * @see docs/decisions/0021-http-boundary-and-sse.md
 */

/**
 * {@link write} 需要的最小面。
 *
 * @remarks
 * NOTE: 收窄到三个成员，测试就不用造一个真的 `ServerResponse`；
 * 而真的 `ServerResponse` 仍然结构满足它。
 */
export type Sink = {
  write(chunk: string): boolean;
  once(event: "drain" | "close", listener: () => void): unknown;
  off(event: "drain" | "close", listener: () => void): unknown;
};

/**
 * 写一块，等到「可以写下一块」为止。
 *
 * @param sink - 响应流
 * @param chunk - 已经编码好的一整个事件，不许半个事件分两次写
 * @returns 缓冲排空、或者对端已经走了
 */
export function write(sink: Sink, chunk: string): Promise<void> {
  if (sink.write(chunk)) return Promise.resolve();
  return new Promise((resolve) => {
    // IMPORTANT: 两个事件共用一个回调，谁先来都要把另一个摘掉 ——
    //            一条 SSE 连接会写几千块，每块留一对监听器就是泄漏。
    const go = (): void => {
      sink.off("drain", go);
      sink.off("close", go);
      resolve();
    };
    sink.once("drain", go);
    sink.once("close", go);
  });
}
