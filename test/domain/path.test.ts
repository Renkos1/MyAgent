import { describe, expect, it } from "vitest";

import type { PathError } from "../../src/domain/path.ts";
import { resolveInsideRoot } from "../../src/domain/path.ts";

/**
 * root 故意选一个有「相邻兄弟目录」的名字：
 * /repo 之外还可能存在 /repo-evil、/repoX、/repo.bak —— 前缀边界才测得出来。
 */
const ROOT = "/repo";

/** NUL 字节。写成转义，别在源码里放裸字节。 */
const NUL = "\u0000";

describe("resolveInsideRoot", () => {
  // ── 接受 ────────────────────────────────────────────────────
  // 断言整个 Result，不做分支：实现若错误地返回 ok:false，这里照样红。
  describe("接受：解析后落在 root 内", () => {
    it.each<{ candidate: string; value: string; why: string }>([
      {
        why: "普通子路径",
        candidate: "docs/README.md",
        value: "/repo/docs/README.md",
      },
      { why: "多级子路径", candidate: "a/b/c.txt", value: "/repo/a/b/c.txt" },
      { why: "单字符（最短的非空）", candidate: "a", value: "/repo/a" },
      {
        why: "./ 前缀被吃掉",
        candidate: "./docs/a.md",
        value: "/repo/docs/a.md",
      },
      {
        why: "重复分隔符被合并",
        candidate: "docs//a.md",
        value: "/repo/docs/a.md",
      },
      {
        why: "先进去再回来",
        candidate: "docs/../README.md",
        value: "/repo/README.md",
      },
      { why: "绕出去又绕回来", candidate: "../repo/a.md", value: "/repo/a.md" },
      { why: "root 自己（.）", candidate: ".", value: "/repo" },
      { why: "root 自己（抵消掉）", candidate: "docs/..", value: "/repo" },
      { why: "尾斜杠保留（契约③）", candidate: "docs/", value: "/repo/docs/" },
      {
        why: "反斜杠当分隔符（契约④）",
        candidate: "docs\\a.md",
        value: "/repo/docs/a.md",
      },
      {
        why: "文件名以点开头，不是穿越",
        candidate: "..foo",
        value: "/repo/..foo",
      },
      { why: "文件名全是点，不是穿越", candidate: "...", value: "/repo/..." },
      { why: "文件名中间有点", candidate: "foo..bar", value: "/repo/foo..bar" },
      { why: "空格是合法文件名", candidate: " ", value: "/repo/ " },
    ])("$why｜$candidate → $value", ({ candidate, value }) => {
      expect(resolveInsideRoot(ROOT, candidate)).toEqual({ ok: true, value });
    });
  });

  // ── 拒绝 ────────────────────────────────────────────────────
  describe("拒绝", () => {
    it.each<{ candidate: string; kind: PathError["kind"]; why: string }>([
      { why: "空串", candidate: "", kind: "empty" },

      {
        why: "绝对路径，指向外部（契约⑥）",
        candidate: "/etc/passwd",
        kind: "absolute",
      },
      {
        why: "绝对路径，即使指向 root 内（契约⑥）",
        candidate: "/repo/a.md",
        kind: "absolute",
      },

      { why: "一级穿越", candidate: "../secret", kind: "escapes-root" },
      {
        why: "深层穿越",
        candidate: "docs/../../../secret",
        kind: "escapes-root",
      },
      { why: "只有 ..", candidate: "..", kind: "escapes-root" },
      {
        why: "反斜杠形式的穿越（契约④的后果）",
        candidate: "..\\..\\secret",
        kind: "escapes-root",
      },

      // ★这三条是这份测试的核心★
      // 它们解析后都以字符串 "/repo" 开头，但都在 root 外面。
      {
        why: "★前缀陷阱★ 兄弟目录",
        candidate: "../repo-evil/secret",
        kind: "escapes-root",
      },
      {
        why: "★前缀陷阱★ 只多一个字符",
        candidate: "../repoX",
        kind: "escapes-root",
      },
      {
        why: "★前缀陷阱★ 带点后缀",
        candidate: "../repo.bak/x",
        kind: "escapes-root",
      },

      { why: "含 NUL 字节", candidate: `a${NUL}.md`, kind: "nul-byte" },
    ])("$why｜$candidate → $kind", ({ candidate, kind }) => {
      expect(resolveInsideRoot(ROOT, candidate)).toEqual({
        ok: false,
        error: { kind },
      });
    });
  });

  // ── 不变量 ──────────────────────────────────────────────────
  // 不是「某个输入 → 某个输出」，而是「对所有输入都成立的性质」。
  // 阶段 1 后面接 fast-check 时，这一节会长成属性测试。
  describe("不变量", () => {
    it("成功时返回的一定是绝对路径", () => {
      const r = resolveInsideRoot(ROOT, "docs/a.md");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.startsWith("/")).toBe(true);
    });

    it("★不读 process.cwd()★：换掉 cwd 结果不变", () => {
      const before = resolveInsideRoot(ROOT, "docs/a.md");
      const cwd = process.cwd();
      try {
        process.chdir("/tmp");
        expect(resolveInsideRoot(ROOT, "docs/a.md")).toEqual(before);
      } finally {
        process.chdir(cwd);
      }
    });
  });
});
