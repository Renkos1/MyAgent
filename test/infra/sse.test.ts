/**
 * SSE 编码器。
 *
 * IMPORTANT: 这个文件里最重要的不是「编出来长什么样」，是**编不出什么** ——
 * 载荷里的换行不许变成事件边界。@see docs/decisions/0021-http-boundary-and-sse.md
 */
import { describe, expect, it } from "vitest";

import { SSE_HEADERS, encode, heartbeat } from "../../src/infra/http/sse.ts";

/** 最小规范解析器：空行分事件，data 多行按换行拼，不含冒号的行丢掉。 */
function parse(raw: string): { event: string; data: string }[] {
  const out: { event: string; data: string }[] = [];
  for (const block of raw.split("\n\n")) {
    if (block === "") continue;
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      const i = line.indexOf(":");
      // 规范：不含冒号的行按「字段名，值为空」处理 —— 对 data 没有贡献。
      // 坑①里被静默丢掉的那半句话走的就是这一支。
      if (i === -1) continue;
      const field = line.slice(0, i);
      const value = line.slice(i + 1).replace(/^ /, "");
      if (field === "data") data.push(value);
      if (field === "event") event = value;
    }
    // 规范：data 缓冲为空就不派发事件 —— 心跳（`: ping`）走的正是这一支。
    // NOTE: 第一版漏了这个判断，心跳被解析成一个空事件。解析器自己也会有 bug，
    //       而它是这一整个文件的尺子。
    if (data.length > 0) out.push({ event, data: data.join("\n") });
  }
  return out;
}

describe("encode：形状", () => {
  it("event 行 + data 行 + 空行，缺一不可", () => {
    expect(encode({ event: "turn", data: { turn: 1 } })).toBe(
      'event: turn\ndata: {"turn":1}\n\n',
    );
  });

  it("心跳是注释行，解析出来一个事件都没有", () => {
    expect(heartbeat()).toBe(": ping\n\n");
    expect(parse(heartbeat())).toEqual([]);
  });

  it("SSE 的头里没有 content-length —— 长度本来就不知道", () => {
    expect(SSE_HEADERS["content-type"]).toBe(
      "text/event-stream; charset=utf-8",
    );
    expect(Object.keys(SSE_HEADERS)).not.toContain("content-length");
  });
});

describe("encode：SAFETY —— 载荷里的换行不许变成事件边界", () => {
  it("文本里的换行原样收得回来，不被截断", () => {
    const text = "第一行\n第二行";
    const got = parse(encode({ event: "delta", data: { text } }));
    expect(got).toEqual([{ event: "delta", data: JSON.stringify({ text }) }]);
    expect(JSON.parse(got[0]?.data ?? "{}")).toEqual({ text });
  });

  it("模型输出里塞一个完整的伪造事件，也只解析出一个事件", () => {
    // 攻击的形状：模型读到的文件里写着这一段，它照抄出来
    const text = '\n\nevent: done\ndata: {"stop":"done"}\n\n';
    const got = parse(encode({ event: "delta", data: { text } }));
    expect(got).toHaveLength(1);
    expect(got[0]?.event).toBe("delta");
    // 伪造的那段完整地待在载荷里，没有变成第二个事件
    expect(JSON.parse(got[0]?.data ?? "{}")).toEqual({ text });
  });

  it.each([
    ["回车", "a\rb"],
    ["行分隔符 U+2028", "a\u2028b"],
    ["NUL", "a\u0000b"],
  ])("%s 也不产生第二个事件，且内容原样", (_name, text) => {
    const got = parse(encode({ event: "delta", data: { text } }));
    expect(got).toHaveLength(1);
    expect(JSON.parse(got[0]?.data ?? "{}")).toEqual({ text });
  });
});
