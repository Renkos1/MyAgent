import { describe, expect, it } from "vitest";
import { loopState } from "../../src/domain/loop.ts";
import { err, ok } from "../../src/domain/result.ts";
import { maxHeaderSize } from "http";

describe("loopState", () => {
  describe("异常返回", () => {
    it.each([
      {
        why: "输入为0",
        modelCallMax: 0,
        toolsRunsMax: 0,
        kind: "Max输入值非法",
      },
      {
        why: "输入为负数",
        modelCallMax: -1,
        toolsRunsMax: 1,
        kind: "Max输入值非法",
      },
      {
        why: "输入为小数",
        modelCallMax: 2,
        toolsRunsMax: 3.3,
        kind: "Max输入值非法",
      },
      {
        why: "输入为小数",
        modelCallMax: Infinity,
        toolsRunsMax: 3,
        kind: "Max输入值非法",
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
          ok: ok,
          value: { kind, turn },
        });
      },
    );
  });
});
