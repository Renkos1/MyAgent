/**
 * 线格式 —— 客户端看到的那套词汇（ADR 0021 D1）。
 *
 * @remarks
 * IMPORTANT: 这是**对外契约**，不是内部类型的镜像。事件名是闭集、是英文、
 * 是判别值（CLAUDE.md 的第①类字符串）—— 改一个名字等于要求所有客户端一起改。
 *
 * 两条设计上的取舍，写下来省得后人重推：
 *
 * 1. `done` 里**不重复答案全文**。「全部 delta 拼起来等于最终答案」是端口的
 *    不变量，用例层测试摁着它；再发一份就是第二个真相来源，两边一漂就没人
 *    知道该信谁。
 * 2. `tool` 事件**不带工具结果的内容**。它是进度显示，不是数据通道 ——
 *    内容会喂给模型，再作为答案流回来。SAFETY: 现在还没有鉴权（决策清单
 *    第 3 条把它排在阶段 11），把文件内容原样推给任何连上来的人，代价太大。
 *
 * @see docs/decisions/0021-http-boundary-and-sse.md
 */
import type { RunEvent, RunResult } from "../../app/runTurn.ts";

/** 客户端会收到的全部事件名。IMPORTANT: 闭集，加一个就是改契约。 */
export type WireEventName =
  "turn" | "delta" | "tool" | "retry" | "truncated" | "done";

/** 一个线格式事件：名字 + 一坨会被 JSON 序列化的数据。 */
export type WireEvent =
  | { readonly event: "turn"; readonly data: { readonly turn: number } }
  | { readonly event: "delta"; readonly data: { readonly text: string } }
  | {
      readonly event: "tool";
      readonly data: {
        readonly phase: "started" | "finished";
        readonly id: string;
        readonly name: string;
        /** 只有 finished 才有。取的是 outcome 的 kind，不是内容。 */
        readonly outcome?: string;
      };
    }
  | {
      readonly event: "retry";
      readonly data: { readonly attempt: number; readonly afterMs: number };
    }
  | { readonly event: "truncated"; readonly data: { readonly index: number } }
  | {
      readonly event: "done";
      readonly data: {
        readonly stop: "done" | "aborted";
        /** 领域拒绝时说明是哪一条规则挡的；正常说完就没有。 */
        readonly reason?: string;
        readonly budget: {
          readonly modelCalls: number;
          readonly toolRuns: number;
          readonly inputBytes: number;
        };
      };
    };

/**
 * 用例层的事件 → 线格式事件。
 *
 * @remarks
 * IMPORTANT: 写成穷尽 switch，{@link RunEvent} 长出新一格时 tsc 会点名 ——
 * 逼人当场答一次「这一格要不要给客户端看」。默认不发是一种选择，
 * 但它必须是被选过的，不是漏掉的。
 *
 * @param e - 用例层吐出来的事件
 * @returns 该发给客户端的事件
 */
export function toWire(e: RunEvent): WireEvent {
  switch (e.kind) {
    case "turn-started":
      return { event: "turn", data: { turn: e.turn } };
    case "text":
      return { event: "delta", data: { text: e.delta } };
    case "tool-started":
      return {
        event: "tool",
        data: { phase: "started", id: e.call.id, name: e.call.name },
      };
    case "tool-finished":
      return {
        event: "tool",
        data: {
          phase: "finished",
          id: e.call.id,
          name: e.call.name,
          outcome: e.outcome.kind,
        },
      };
    case "retrying":
      return {
        event: "retry",
        data: { attempt: e.attempt, afterMs: e.afterMs },
      };
    case "input-truncated":
      return { event: "truncated", data: { index: e.index } };
  }
}

/**
 * 用例层的结局 → 终止事件。
 *
 * @remarks
 * IMPORTANT: 只有「说完了」和「领域把它挡下了」这两种结局配拿到终止事件。
 * `failed`（端口失败）和 `setup`（输入不合法）走别的路 ——
 * 前者掐 socket（ADR 0021 D2），后者根本还没开始流。
 * 返回 null 就是在说「这不该走终止事件这条路」。
 *
 * @param r - 用例层的结局
 * @returns 终止事件；不该发终止事件时是 null
 */
export function toTerminal(r: RunResult): WireEvent | null {
  if (r.kind === "failed" || r.kind === "setup") return null;
  const budget = {
    modelCalls: r.budget.modelCalls,
    toolRuns: r.budget.toolRuns,
    inputBytes: r.budget.inputBytes,
  };
  return r.kind === "done"
    ? { event: "done", data: { stop: "done", budget } }
    : {
        event: "done",
        data: { stop: "aborted", reason: r.reason.kind, budget },
      };
}
