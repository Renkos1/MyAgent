import { describe, expect, it } from "vitest";
import { resolveInsideRoot } from "../../src/domain/path.ts";

describe("resolveInsideRoot", () => {
  describe("当不同输入时，结果是否正确", () => {
    const root = "/test";
    it.each([
      { candidate: "", expected: "empty", why: "输入为空" },
      { candidate: "/src", expected: "absolute", why: "输入是绝对路径" },
      { candidate: "../eval.txt", expected: "escapes-root", why: "输入越界" },
      {
        candidate: "doc/../../eval.txt",
        expected: "escapes-root",
        why: "输入越界",
      },
      {
        candidate: "..foo",
        expected: "/test/..foo",
        why: "允许文件名包含..",
      },
      {
        candidate: "foo..bar",
        expected: "/test/foo..bar",
        why: "允许文件名包含..",
      },
      {
        candidate: " ",
        expected: "/test/ ",
        why: "空格可能是文件名",
      },
      {
        candidate: "...",
        expected: "/test/...",
        why: "... 可能是文件名",
      },
      {
        candidate: "doc/",
        expected: "/test/doc/",
        why: "校验路径包含/时保留",
      },
      {
        candidate: "doc/..",
        expected: "/test",
        why: "规范化后是根目录",
      },

      {
        candidate: "eval.txt",
        expected: "/test/eval.txt",
        why: "输入是子目录",
      },
      {
        candidate: ".",
        expected: "/test",
        why: "输入为根目录路径",
      },
      {
        candidate: "../test/eval.txt",
        expected: "/test/eval.txt",
        why: "输入规范化后是子目录",
      },
      {
        candidate: "doc\\eval.txt",
        expected: "/test/doc/eval.txt",
        why: "输入是windows 的反斜杠时，规范化",
      },
      {
        candidate: "/test/eval.txt",
        expected: "/test/eval.txt",
        why: "当输入是根目录开始的绝对路径时满足",
      },
    ])(
      "$why: resolveInsideRoot(root, $candidate) -> $expected",
      ({ candidate, expected }) => {
        const result = resolveInsideRoot(root, candidate);
        if (result.ok) {
          expect(result.value).toBe(expected);
        } else {
          expect(result.error).toContain(expected);
        }
      },
    );
    it("当输入异常时，报错是否返回错误路径", () => {
      const candidate = "/src";
      const result = resolveInsideRoot(root, candidate);
      if (!result.ok) expect(result.error).toContain(candidate);
    });
  });
});
