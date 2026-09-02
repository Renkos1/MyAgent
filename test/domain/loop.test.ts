import { describe, expect, it } from "vitest";
import { loopState } from "../../src/domain/loop.ts";

describe("loopState", () => {
  describe("异常返回", () => {
    it.each([
      {
        why: "modelCallMax输入为0",
        modelCallMax: 0,
        toolsRunsMax: 0,
        kind: "modelCallMaxError",
      },
      {
        why: "modelCallMax输入为负数",
        modelCallMax: -1,
        toolsRunsMax: 1,
        kind: "modelCallMaxError",
      },
      {
        why: "modelCallMax输入为小数",
        modelCallMax: 2.2,
        toolsRunsMax: 3,
        kind: "modelCallMaxError",
      },
      {
        why: "modelCallMax输入为Infinity",
        modelCallMax: Infinity,
        toolsRunsMax: 3,
        kind: "modelCallMaxError",
      },
      {
        why: "toolsRunsMax输入为0",
        modelCallMax: 1,
        toolsRunsMax: 0,
        kind: "toolRunsMaxError",
      },
      {
        why: "toolsRunsMax输入为负数",
        modelCallMax: 1,
        toolsRunsMax: -1,
        kind: "toolRunsMaxError",
      },
      {
        why: "toolsRunsMax输入为小数",
        modelCallMax: 2,
        toolsRunsMax: 3.3,
        kind: "toolRunsMaxError",
      },
      {
        why: "toolsRunsMax输入为Infinity",
        modelCallMax: 3,
        toolsRunsMax: Infinity,
        kind: "toolRunsMaxError",
      },
    ])(
      "$why|modelCallMax|toolsRunsMax -> $kind",
      ({ modelCallMax, toolsRunsMax, kind }) => {
        expect(loopState(modelCallMax, toolsRunsMax)).toEqual({
          ok: false,
          error: { kind },
        });
      },
    );
  });
  describe("正常返回", () => {
    it.each([
      {
        why: "",
        modelCallMax: 1,
        toolsRunsMax: 1,
        kind: "",
        turn: 1,
      },
    ])(
      "$why|modelCallMax|toolsRunsMax -> $kind|$turn",
      ({ modelCallMax, toolsRunsMax, kind, turn }) => {
        expect(loopState(modelCallMax, toolsRunsMax)).toEqual({
          ok: true,
          value: { kind, turn },
        });
      },
    );
  });
});
