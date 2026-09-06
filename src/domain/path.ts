import path from "node:path";

import type { Result } from "./result.ts";
import { err, ok } from "./result.ts";

/**
 * 路径校验失败的原因。
 *
 * @remarks
 * 每个 kind 描述的是失败的**原因**，不是输入的形状 ——
 * 调用方要靠它决定「怎么处理」，不是「怎么描述」。
 */
export type PathError =
  | { readonly kind: "empty" }
  | { readonly kind: "absolute" }
  | { readonly kind: "escapes-root" }
  | { readonly kind: "nul-byte" };

/** NUL 字节。fs 遇到它会抛 ERR_INVALID_ARG_VALUE，在这一层先拒掉。 */
const NUL = "\u0000";

/**
 * 把模型/用户给的一个路径解析成仓库内的绝对路径；越界一律拒绝。
 *
 * @remarks
 * 纯函数：不 stat、不 readFile、不碰 fs，只做字符串和路径运算。
 * 符号链接、文件存不存在都不归它管（IO 适配器的事）。
 *
 * SAFETY: 这是 CWE-22（路径穿越）的战场。三条实现约束不能动，
 * 见 ADR 0008 的「SAFETY」一节。
 *
 * @param root - 仓库根目录的 POSIX 绝对路径
 * @param candidate - 待校验的路径（仓库相对）
 * @returns 成功时是仓库内的绝对路径；失败时 {@link PathError}
 *          ——  NOTE: 它只带 kind，不带那个路径，因为那个值来自模型/用户
 * @see docs/decisions/0008-path-resolution.md  八个决定的候选、判据、代价
 */
export function resolveInsideRoot(
  root: string,
  candidate: string,
): Result<string, PathError> {
  if (candidate === "") return err({ kind: "empty" });
  if (candidate.includes(NUL)) return err({ kind: "nul-byte" });

  // SAFETY: 反斜杠替换必须在 isAbsolute / resolve 之前，
  //         否则 "..\..\x" 在 POSIX 下会被当成一个含反斜杠的文件名，不是穿越。
  const normalized = candidate.replaceAll("\\", "/");

  // SAFETY: 绝对路径一律拒绝，且必须在 resolve 之前判断 ——
  //         resolve 遇到绝对路径会丢弃左边所有参数，root 就完全失效了。
  if (path.posix.isAbsolute(normalized)) return err({ kind: "absolute" });

  // IMPORTANT: 用 path.posix 而不是 path —— 开发在 Windows、运行在 Linux，
  //            path.resolve 在 Windows 上会补盘符（C:\repo\...）。
  //            这条有 ESLint no-restricted-syntax 守着，不只是注释。
  const abs = path.posix.resolve(root, normalized);

  // SAFETY: 不能用 abs.startsWith(root) —— 那是字符串前缀比较，不懂分隔符，
  //         "/repo-evil" 也以 "/repo" 开头（CWE-22）。
  //         正确判据：要走出 root，从 root 出发的第一步必然是 ".."。
  const rel = path.posix.relative(root, abs);
  if (rel === ".." || rel.startsWith(`..${path.posix.sep}`)) {
    return err({ kind: "escapes-root" });
  }

  // 尾斜杠保留（ADR 0008 §③）。resolve 会把它吃掉，这里补回来。
  // NOTE: rel === "" 表示目标就是 root 自己，那时不补（避免 "/repo" → "/repo/"）。
  const keepTrailingSlash = normalized.endsWith("/") && !abs.endsWith("/");
  return ok(keepTrailingSlash ? `${abs}/` : abs);
}
