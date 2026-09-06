/**
 * ToolPort 的契约套件。比 LlmPort 那份薄，因为端口窄：只有一个方法、没有流。
 *
 * IMPORTANT: 这里最贵的一条是「不抛异常」。工具适配器真正会写的是 fs / 子进程，
 * 而那两样默认就是抛的 —— 让 ENOENT 冒泡出去是最容易犯的违约，
 * 而且用例层一个 try 都没有（runTurn 的契约写着「它不抛异常」）。
 */
import { describe, expect, it } from "vitest";

import type {
  CallOptions,
  ToolCall,
  ToolOutcome,
  ToolPort,
} from "../../src/app/ports.ts";

/**
 * 契约要摆的格子。
 *
 * IMPORTANT: 它**不等于** `ToolOutcome["kind"]` —— aborted 那一格要拆成两个场景。
 * 理由和 LlmPort 那边 `aborted-before-send` / `aborted-mid-flight` 完全一样：
 * 场景集是对**外面的世界**建模，端口的 kind 是压平之后的结果，
 * 一个 kind 底下可能藏着两种外部事实（ADR 0015 §④）。
 */
export type ToolCase =
  Exclude<ToolOutcome["kind"], "aborted"> | "aborted-before" | "aborted-during";

/** 每个格子对应外面的什么事。少一格 tsc 就红 —— 和场景表同一个手法。 */
export const TOOL_SCENARIOS: Readonly<Record<ToolCase, string>> = {
  ok: "文件读到了",
  denied: "路径校验拒绝（CWE-22 那一类）",
  "not-found": "目标不存在",
  "too-large": "超过单次读取的字节上限",
  failed: "IO 出错 / 超时 / 说不上来",
  "aborted-before": "还没开跑就被叫停（ADR 0014 §①：取消不是失败）",
  "aborted-during": "跑到一半被叫停 —— 副作用发生没有，我们不知道",
};

const KINDS = Object.keys(TOOL_SCENARIOS) as ToolCase[];

/**
 * 契约只比这两样。
 *
 * NOTE: content / bytes / reason 是各实现自己的事，契约不碰 ——
 * 碰了就退化成实现测试（engineering/25 坑⑧）。
 */
type Shape = { readonly kind: string; readonly sideEffect: string | null };

/** 投影成好整对象比较的形状。 */
function shapeOf(o: ToolOutcome): Shape {
  return {
    kind: o.kind,
    sideEffect: o.kind === "aborted" ? o.sideEffect : null,
  };
}

/** 每个格子该落成什么。IMPORTANT: 两格 aborted 的 sideEffect 必须不同。 */
const EXPECTED: Readonly<Record<ToolCase, Shape>> = {
  ok: { kind: "ok", sideEffect: null },
  denied: { kind: "denied", sideEffect: null },
  "not-found": { kind: "not-found", sideEffect: null },
  "too-large": { kind: "too-large", sideEffect: null },
  failed: { kind: "failed", sideEffect: null },
  "aborted-before": { kind: "aborted", sideEffect: "none" },
  "aborted-during": { kind: "aborted", sideEffect: "unknown" },
};

/**
 * 把实现驱动到某个结果。返回 null = 摆不出，那一格进能力矩阵。
 *
 * NOTE: 要连 opts 一起给回来 —— aborted 那一格只有靠 signal 才摆得出，
 * 而 signal 是 run 的参数，不是端口的构造参数。
 */
export type ToolStage = (kind: ToolCase) => {
  readonly port: ToolPort;
  readonly call: ToolCall;
  readonly opts: CallOptions | undefined;
} | null;

/** 一个被测的工具实现。 */
export type ToolSubject = {
  readonly name: string;
  readonly stage: ToolStage;
  /** 摆不出的结果。声明和现实双向核对。 */
  readonly cannotStage: readonly ToolCase[];
  /** 一个这个实现没预料到的调用，用来验「不抛」。 */
  readonly surprise: { readonly port: ToolPort; readonly call: ToolCall };
};

/**
 * 跑一遍 ToolPort 的契约。
 *
 * @param subject - 被测实现 + 它摆不出的结果 + 一个意料之外的调用
 */
/** run 的返回值只能落在这几个 kind 上。NOTE: 和 ToolCase 不是一回事。 */
const OUTCOME_KINDS: readonly ToolOutcome["kind"][] = [
  "ok",
  "denied",
  "not-found",
  "too-large",
  "failed",
  "aborted",
];

export function toolPortContract(subject: ToolSubject): void {
  const stageable = KINDS.filter((k) => !subject.cannotStage.includes(k));
  const declaredMissing = KINDS.filter((k) => subject.cannotStage.includes(k));

  describe(`ToolPort 契约 · ${subject.name}`, () => {
    it("声明摆不出的结果，工厂必须真的给不出端口", () => {
      expect(declaredMissing.map((k) => [k, subject.stage(k)])).toEqual(
        declaredMissing.map((k) => [k, null]),
      );
    });

    it.each(stageable)("%s · run 落在约定的那一格", async (kind) => {
      const staged = subject.stage(kind);
      if (staged === null)
        throw new Error(`${kind}: 声明说摆得出，却给了 null`);
      const outcome = await staged.port.run(staged.call, staged.opts);
      // 整对象比较，不是只比 kind —— 只比 kind 的话两格 aborted 分不出来
      expect(shapeOf(outcome)).toEqual(EXPECTED[kind]);
    });

    // IMPORTANT: 单独一条，因为上面那条是「摆得出吗」，这一条是
    //            「两种取消真的说成了两句话吗」。合并了，一个把 sideEffect
    //            写死成 "unknown" 的实现照样全绿（ADR 0015 §③）。
    it("两种取消的 sideEffect 不同 —— 这一格不许压平", async () => {
      const before = subject.stage("aborted-before");
      const during = subject.stage("aborted-during");
      if (before === null || during === null) return; // 摆不出的由能力矩阵管
      const a = await before.port.run(before.call, before.opts);
      const b = await during.port.run(during.call, during.opts);
      expect([shapeOf(a).sideEffect, shapeOf(b).sideEffect]).toEqual([
        "none",
        "unknown",
      ]);
    });

    // TRAP: 这一条不能和上面那条合并。上面问的是「摆得出这一格吗」，
    //       这一条问的是「取消压不压得过表里摆好的答案」——
    //       合并了就分不出「没看 signal」和「表里本来就没有」。
    it("signal 已经 aborted 时，压过表里摆好的答案", async () => {
      const staged = subject.stage("ok");
      if (staged === null) throw new Error("ok 都摆不出，契约无从谈起");
      const outcome = await staged.port.run(staged.call, {
        signal: AbortSignal.abort(),
      });
      // 进来之前就取消 = 一步没跑，所以这里必须是 none 不是 unknown
      expect(shapeOf(outcome)).toEqual({ kind: "aborted", sideEffect: "none" });
    });

    it("意料之外的调用也返回结果，不抛", async () => {
      const outcome = await subject.surprise.port.run(subject.surprise.call);
      expect(OUTCOME_KINDS).toContain(outcome.kind);
    });

    it.each([undefined, {}] as const)("opts 是 %o 时也能跑", async (opts) => {
      const staged = subject.stage(stageable[0] ?? "ok");
      if (staged === null) throw new Error("一个结果都摆不出，契约无从谈起");
      const outcome = await staged.port.run(staged.call, opts);
      expect(OUTCOME_KINDS).toContain(outcome.kind);
    });
  });
}
