/**
 * ToolPort 的契约套件。比 LlmPort 那份薄，因为端口窄：只有一个方法、没有流。
 *
 * IMPORTANT: 这里最贵的一条是「不抛异常」。工具适配器真正会写的是 fs / 子进程，
 * 而那两样默认就是抛的 —— 让 ENOENT 冒泡出去是最容易犯的违约，
 * 而且用例层一个 try 都没有（runTurn 的契约写着「它不抛异常」）。
 */
import { describe, expect, it } from "vitest";

import type { ToolCall, ToolOutcome, ToolPort } from "../../src/app/ports.ts";

/**
 * 五种结果各自对应外面的什么事。
 *
 * NOTE: 键是 ToolOutcome["kind"]，少一格 tsc 就红 —— 和场景表同一个手法。
 */
export const TOOL_SCENARIOS: Readonly<Record<ToolOutcome["kind"], string>> = {
  ok: "文件读到了",
  denied: "路径校验拒绝（CWE-22 那一类）",
  "not-found": "目标不存在",
  "too-large": "超过单次读取的字节上限",
  failed: "IO 出错 / 超时 / 说不上来",
};

const KINDS = Object.keys(TOOL_SCENARIOS) as ToolOutcome["kind"][];

/** 把实现驱动到某个结果。返回 null = 摆不出，那一格进能力矩阵。 */
export type ToolStage = (
  kind: ToolOutcome["kind"],
) => { readonly port: ToolPort; readonly call: ToolCall } | null;

/** 一个被测的工具实现。 */
export type ToolSubject = {
  readonly name: string;
  readonly stage: ToolStage;
  /** 摆不出的结果。声明和现实双向核对。 */
  readonly cannotStage: readonly ToolOutcome["kind"][];
  /** 一个这个实现没预料到的调用，用来验「不抛」。 */
  readonly surprise: { readonly port: ToolPort; readonly call: ToolCall };
};

/**
 * 跑一遍 ToolPort 的契约。
 *
 * @param subject - 被测实现 + 它摆不出的结果 + 一个意料之外的调用
 */
export function toolPortContract(subject: ToolSubject): void {
  const stageable = KINDS.filter((k) => !subject.cannotStage.includes(k));
  const declaredMissing = KINDS.filter((k) => subject.cannotStage.includes(k));

  describe(`ToolPort 契约 · ${subject.name}`, () => {
    it("声明摆不出的结果，工厂必须真的给不出端口", () => {
      expect(declaredMissing.map((k) => [k, subject.stage(k)])).toEqual(
        declaredMissing.map((k) => [k, null]),
      );
    });

    it.each(stageable)("%s · run 解析出这一格", async (kind) => {
      const staged = subject.stage(kind);
      if (staged === null)
        throw new Error(`${kind}: 声明说摆得出，却给了 null`);
      const outcome = await staged.port.run(staged.call);
      expect(outcome.kind).toBe(kind);
    });

    it("意料之外的调用也返回结果，不抛", async () => {
      const outcome = await subject.surprise.port.run(subject.surprise.call);
      expect(KINDS).toContain(outcome.kind);
    });

    it.each([undefined, {}] as const)("opts 是 %o 时也能跑", async (opts) => {
      const staged = subject.stage(stageable[0] ?? "ok");
      if (staged === null) throw new Error("一个结果都摆不出，契约无从谈起");
      const outcome = await staged.port.run(staged.call, opts);
      expect(KINDS).toContain(outcome.kind);
    });
  });
}
