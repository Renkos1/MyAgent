import { describe, expect, it } from "vitest";
import { resolveInsideRoot } from "../../src/domain/path.ts";

describe("resolveInsideRoot", () => {
  describe("", () => {
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
        expected: "..foo",
        why: "允许文件名包含..",
      },
      {
        candidate: "foo..bar",
        expected: "foo..bar",
        why: "允许文件名包含..",
      },
      {
        candidate: " ",
        expected: " ",
        why: "空格可能是文件名",
      },
      {
        candidate: "...",
        expected: "...",
        why: "... 可能是文件名",
      },
      {
        candidate: "doc/",
        expected: "doc/",
        why: "校验路径包含/时保留",
      },
      {
        candidate: "doc/..",
        expected: "",
        why: "规范化后是根目录",
      },

      {
        candidate: "eval.txt",
        expected: "eval.txt",
        why: "输入是子目录",
      },
      {
        candidate: ".",
        expected: "",
        why: "输入为根目录路径",
      },
      {
        candidate: "../test/eval.txt",
        expected: "eval.txt",
        why: "输入规范化后是子目录",
      },
    ])(
      "$why: resolveInsideRoot(root, $candidate) -> $expected",
      ({ candidate, expected }) => {
        const result = resolveInsideRoot(root, candidate);
        if (result.ok) {
          expect(result.value).toBe(expect);
        } else {
          expect(result.error).toContain(expected);
        }
      },
    );
  });
});
