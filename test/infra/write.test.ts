/**
 * 背压（ADR 0021 D2 的邻居）。
 *
 * IMPORTANT: 这个文件里最重要的一条是**第三个用例** —— 客户端走了之后
 * `drain` 永远不会再来。只等 drain 的实现在那一刻挂死，而挂死从外面看
 * 和「正在等」一模一样：没有异常、没有日志、事件流就是停在那里。
 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import type { Sink } from "../../src/infra/http/write.ts";
import { write } from "../../src/infra/http/write.ts";

/** 一个能按需说「缓冲满了」的假响应流。 */
class FakeSink extends EventEmitter implements Sink {
  /** true = 之后每次 write 都返回 false，也就是「别再写了」。 */
  full = false;
  readonly written: string[] = [];

  write(chunk: string): boolean {
    this.written.push(chunk);
    return !this.full;
  }
}

/** 让已经排好的回调跑完。NOTE: 比 `await Promise.resolve()` 靠后一档。 */
const tick = (): Promise<void> =>
  new Promise((r) => {
    setImmediate(r);
  });

describe("write：缓冲没满", () => {
  it("直接放行 —— 写出去了，也没有挂住", async () => {
    const sink = new FakeSink();
    await write(sink, "a");
    expect(sink.written).toEqual(["a"]);
  });
});

describe("write：缓冲满了", () => {
  it("不放行，直到 drain", async () => {
    const sink = new FakeSink();
    sink.full = true;
    let passed = false;
    const p = write(sink, "a").then(() => {
      passed = true;
    });

    // IMPORTANT: 少了这一条，一个「立刻 resolve」的假 await 也能让本用例绿
    await tick();
    expect(passed).toBe(false);

    sink.emit("drain");
    await p;
    expect(passed).toBe(true);
  });

  it("对端走了 → close 也放行，不许挂死", async () => {
    const sink = new FakeSink();
    sink.full = true;
    const p = write(sink, "a");
    // drain 永远不会来了。挂住的话这条用例只能靠超时收场
    sink.emit("close");
    await p;
    expect(sink.written).toEqual(["a"]);
  });

  it("放行之后监听器摘干净 —— 一条长连接上每块留一对就是泄漏", async () => {
    const sink = new FakeSink();
    sink.full = true;
    const p = write(sink, "a");
    expect(sink.listenerCount("drain")).toBe(1);
    expect(sink.listenerCount("close")).toBe(1);

    sink.emit("drain");
    await p;
    expect(sink.listenerCount("drain")).toBe(0);
    expect(sink.listenerCount("close")).toBe(0);
  });
});
