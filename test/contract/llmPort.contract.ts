/**
 * LlmPort 的契约套件 —— 被测对象是**接口的每一个实现**，不是某一个实现。
 *
 * IMPORTANT: 这里只许用 LlmPort 上出现过的类型。一旦断言了 FakeLlm 特有的东西
 * （比如 `sent` 数组），套件就在真适配器上跑不了，也就失去了全部意义。
 *
 * NOTE: 这个文件不是 .test.ts，vitest 不会直接跑它 —— 它由各实现的 .test.ts 导入。
 *
 * 判据：把 FakeLlm 换成 AnthropicLlm，这个文件一行都不用改。
 */
import { describe, expect, it } from "vitest";

import type {
  LlmError,
  LlmPort,
  LlmRequest,
  LlmResponse,
  StreamChunk,
} from "../../src/app/ports.ts";
import type { Result } from "../../src/domain/result.ts";
import type { Expected, Scenario, ScenarioName } from "./scenarios.ts";
import { SCENARIO_LIST } from "./scenarios.ts";

/**
 * 把一个实现驱动到指定场景。
 *
 * @remarks
 * IMPORTANT: 返回 null = 这个实现摆不出这个场景，那一格进能力矩阵。
 *
 * 对返回的端口有一条要求：**同一个场景要答得起 3 次**（套件会重复问和并发问）。
 * 这条要求所有实现都做得到：Fake 重复脚本，回放重复读同一盘带，真模型重复调。
 */
export type Stage = (scenario: Scenario) => LlmPort | null;

/** 一个被测实现的全部信息。 */
export type LlmSubject = {
  readonly name: string;
  readonly stage: Stage;
  /** 摆不出的场景。IMPORTANT: 声明和现实双向核对，光声明不核对会烂掉。 */
  readonly cannotStage: readonly ScenarioName[];
  /**
   * 这个实现被驱动到某个场景时，要发什么请求。
   *
   * @remarks
   * IMPORTANT: 「问什么」是**驱动方式的一部分**，不是场景的属性 ——
   * 所以它挂在 subject 上，不在 {@link Scenario} 里。
   *
   * 第一版套件写死了一个 REQ，那对 FakeLlm 成立（它按脚本走，不看请求内容），
   * 对真适配器不成立：同一句话问下去，模型给 completed 还是 tool-requested
   * 不由我们说了算。写死请求 = 真实现的一半场景永远摆不出来，
   * 而套件的全部价值就是「同一组断言跑每个实现」。
   *
   * NOTE: 必填，没有默认值。给默认值的话，新实现会静默继承一个
   * 未必适合它的请求 —— 又一处「没有信号的失败」。
   */
  readonly reqFor: (s: Scenario) => LlmRequest;
};

/** FakeLlm 之类「不看请求内容」的实现用这个。 */
export const ANY_REQ: LlmRequest = {
  system: "契约套件",
  history: [{ role: "user", text: "docs 下有什么" }],
};

/** 只有取消类场景才递一个已经 abort 的 signal。 */
function optsFor(s: Scenario): { readonly signal: AbortSignal } | undefined {
  return s.name === "aborted-before-send" || s.name === "aborted-mid-flight"
    ? { signal: AbortSignal.abort() }
    : undefined;
}

/**
 * 把实际结果投影成和 Expected 同一个形状，好整对象比较。
 *
 * NOTE: 整对象比而不是逐字段比 —— 逐字段比的时候少断言一个字段没人看得出来。
 */
function shapeOf(res: Result<LlmResponse, LlmError>): Expected {
  if (res.ok) {
    return {
      ok: true,
      kind: res.value.kind,
      toolCalls:
        res.value.kind === "tool-requested" ? res.value.calls.length : 0,
    };
  }
  return {
    ok: false,
    kind: res.error.kind,
    retryHint:
      res.error.kind !== "unavailable"
        ? "n/a"
        : res.error.retryAfterMs === null
          ? "null"
          : "number",
  };
}

/** 收完一条流。IMPORTANT: 不吞错误 —— 错误块也要留下来比对。 */
async function drain(
  port: LlmPort,
  req: LlmRequest,
  s: Scenario,
): Promise<Result<StreamChunk, LlmError>[]> {
  const out: Result<StreamChunk, LlmError>[] = [];
  for await (const chunk of port.stream(req, optsFor(s))) out.push(chunk);
  return out;
}

/**
 * 跑一遍 LlmPort 的契约。
 *
 * @param subject - 被测实现 + 它声明摆不出的场景
 */
export function llmPortContract(subject: LlmSubject): void {
  const stageable = SCENARIO_LIST.filter(
    (s) => !subject.cannotStage.includes(s.name),
  );
  const declaredMissing = SCENARIO_LIST.filter((s) =>
    subject.cannotStage.includes(s.name),
  );

  describe(`LlmPort 契约 · ${subject.name}`, () => {
    // ── 能力矩阵：声明必须和现实对得上，两个方向都要 ──────────
    it("声明摆不出的场景，工厂必须真的给不出端口", () => {
      expect(declaredMissing.map((s) => [s.name, subject.stage(s)])).toEqual(
        declaredMissing.map((s) => [s.name, null]),
      );
    });

    it("没声明摆不出的场景，工厂必须真的给出端口", () => {
      expect(stageable.map((s) => [s.name, subject.stage(s) !== null])).toEqual(
        stageable.map((s) => [s.name, true]),
      );
    });

    // ── B + D：外面的每一种形状，必须落在约定的那一格 ─────────
    it.each(stageable)("$name · send 落在约定的那一格", async (s: Scenario) => {
      const port = subject.stage(s);
      if (port === null)
        throw new Error(`${s.name}: 声明说摆得出，却给了 null`);
      expect(shapeOf(await port.send(subject.reqFor(s), optsFor(s)))).toEqual(
        s.expected,
      );
    });

    // ── A 的可断言部分：实现不许记住上一次 ────────────────────
    it.each(stageable)(
      "$name · 同一实例连问两次，第二次不受第一次影响",
      async (s: Scenario) => {
        const port = subject.stage(s);
        if (port === null)
          throw new Error(`${s.name}: 声明说摆得出，却给了 null`);
        const first = shapeOf(await port.send(subject.reqFor(s), optsFor(s)));
        const second = shapeOf(await port.send(subject.reqFor(s), optsFor(s)));
        expect([first, second]).toEqual([s.expected, s.expected]);
      },
    );

    it.each(stageable)(
      "$name · 同一实例并发三个请求，三个都拿到结果",
      async (s: Scenario) => {
        const port = subject.stage(s);
        if (port === null)
          throw new Error(`${s.name}: 声明说摆得出，却给了 null`);
        const all = await Promise.all([
          port.send(subject.reqFor(s), optsFor(s)),
          port.send(subject.reqFor(s), optsFor(s)),
          port.send(subject.reqFor(s), optsFor(s)),
        ]);
        expect(all.map(shapeOf)).toEqual([s.expected, s.expected, s.expected]);
      },
    );

    /** 随便一个摆得出的端口 —— 能力表和场景无关，问哪个都一样。 */
    const capabilityPort = (): LlmPort => {
      const s = stageable[0] ?? SCENARIO_LIST[0];
      const port = s === undefined ? null : subject.stage(s);
      if (port === null) throw new Error("一个场景都摆不出，没法问能力");
      return port;
    };

    // ── 能力表本身也是契约的一部分 ────────────────────────────
    // IMPORTANT: 这两条让 ProviderCapabilities 变成**承重**的，
    //            而不是一张写完就没人看的表。声明和行为不一致会红。
    it("能力表存在，且每一格都是三态之一", () => {
      const caps = capabilityPort().capabilities;
      expect(
        Object.entries(caps).map(([k, v]) => [
          k,
          ["yes", "no", "unknown", "none", "automatic", "explicit"].includes(
            v as string,
          ),
        ]),
      ).toEqual(Object.keys(caps).map((k) => [k, true]));
    });

    it("声明 streaming 不是 yes 的实现，不该被拿来跑流式断言", () => {
      // NOTE: 这一条现在必然通过 —— 两个实现都声明 yes。它存在是为了
      //       将来接一个不支持流式的 provider 时，能立刻看见下面那一批
      //       流式断言是在对着一个声明「我不支持」的实现跑。
      expect(capabilityPort().capabilities.streaming).toBe("yes");
    });

    // ── send 和 stream 必须映射到同一格 ───────────────────────
    it.each(stageable)(
      "$name · stream 的结局与 send 同 kind",
      async (s: Scenario) => {
        const port = subject.stage(s);
        if (port === null)
          throw new Error(`${s.name}: 声明说摆得出，却给了 null`);
        const chunks = await drain(port, subject.reqFor(s), s);
        const last = chunks.at(-1);
        if (last === undefined) throw new Error(`${s.name}: 流一块都没吐`);

        if (s.expected.ok) {
          // 成功：最后一块必须是 end，且带着和 send 同 kind 的完整响应
          expect(
            last.ok && last.value.kind === "end"
              ? { ok: true, kind: last.value.response.kind }
              : { ok: last.ok, kind: "不是 end" },
          ).toEqual({ ok: true, kind: s.expected.kind });
        } else {
          // 失败：吐一个错误块然后结束，不许假装成功收尾
          expect(
            last.ok
              ? { ok: true, kind: "流用成功收尾了" }
              : { ok: false, kind: last.error.kind },
          ).toEqual({ ok: false, kind: s.expected.kind });
        }
      },
    );

    // ── 流的中间块也是契约：拼起来必须等于最终答案 ───────────
    it.each(
      stageable.filter((s) => s.expected.ok && s.expected.kind === "completed"),
    )("$name · text 块拼起来就是结尾块的 text", async (s: Scenario) => {
      const port = subject.stage(s);
      if (port === null)
        throw new Error(`${s.name}: 声明说摆得出，却给了 null`);
      let joined = "";
      let whole = "(没有 completed 的结尾块)";
      for (const chunk of await drain(port, subject.reqFor(s), s)) {
        if (!chunk.ok) continue;
        if (chunk.value.kind === "text") joined += chunk.value.delta;
        else if (chunk.value.response.kind === "completed")
          whole = chunk.value.response.text;
      }
      expect(joined).toBe(whole);
    });

    // ── opts 的第三种形状：传了对象但里面没有 signal ──────────
    // TRAP: 只测 undefined 和「带 signal」的话，opts?.signal 里那个可选链
    //       去掉也没人发现 —— 实测：这个变异体活过了第一版契约套件。
    it.each(stageable.filter((s) => optsFor(s) === undefined))(
      "$name · opts 传空对象（有 opts、没 signal）也不崩",
      async (s: Scenario) => {
        const port = subject.stage(s);
        if (port === null)
          throw new Error(`${s.name}: 声明说摆得出，却给了 null`);
        expect(shapeOf(await port.send(subject.reqFor(s), {}))).toEqual(
          s.expected,
        );
      },
    );

    // ── ToolCall.id 是「把结果配回请求」的唯一依据 ────────────
    it.each(stageable.filter((s) => s.expected.ok && s.expected.toolCalls > 1))(
      "$name · calls 的 id 互不重复",
      async (s: Scenario) => {
        const port = subject.stage(s);
        if (port === null)
          throw new Error(`${s.name}: 声明说摆得出，却给了 null`);
        const res = await port.send(subject.reqFor(s), optsFor(s));
        if (!res.ok || res.value.kind !== "tool-requested") {
          throw new Error(`${s.name}: 上一条断言应该先红`);
        }
        const ids = res.value.calls.map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
      },
    );
  });
}
