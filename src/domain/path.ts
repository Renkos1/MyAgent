import type { Result } from "./result.ts";

/**
 * 路径校验失败的原因。
 *
 * 每个 kind 描述的是**失败的原因**，不是输入的形状 ——
 * 调用方要靠它决定「怎么处理」，不是「怎么描述」。
 */
export type PathError =
  | { readonly kind: "empty" }
  | { readonly kind: "absolute" }
  | { readonly kind: "escapes-root" }
  | { readonly kind: "nul-byte" };

/**
 * 把模型/用户给的一个路径，解析成仓库内的绝对路径；越界一律拒绝。
 *
 * ★纯函数★：不 stat、不 readFile、不碰 fs，只做字符串和路径运算。
 * 符号链接、文件存不存在都不归它管（阶段 2 的 IO 适配器）。
 *
 * ── 契约 ────────────────────────────────────────────────────────
 *
 * ① root 本身合法吗？
 *      合法。`"."` 和 `"docs/.."` 都返回 root 的绝对形式。
 *      理由：list_files(".") 是有意义的调用，没道理拒绝。
 *
 * ② 返回绝对还是相对路径？
 *      ★绝对★。调用方拿到就能直接交给 fs，不需要再拼一次 root。
 *      代价：给模型看的时候要自己转回相对，否则会泄露宿主机目录结构。
 *
 * ③ 尾斜杠保留还是归一化？
 *      ★保留★。`"docs/"` → `"/repo/docs/"`。
 *      理由：调用方能据此看出「调用者认为这是个目录」。
 *      代价：下游要能接受同一个位置的两种字符串形态。
 *
 * ④ Windows 反斜杠？
 *      ★当分隔符处理★，先统一换成 `/` 再解析。
 *      理由：开发在 Windows、运行在 Linux，同一个字符串不能有两种语义。
 *      代价：Linux 上一个真的叫 `a\b.txt` 的文件将无法访问。可接受。
 *
 * ⑤ 错误要不要带上出问题的路径？
 *      ★不带★。PathError 只有 kind。
 *      理由：这个值来自模型/用户，直接进日志就是把攻击载荷原样落盘。
 *      调用方手里本来就有入参，需要就自己拼。
 *
 * ⑥ 绝对路径一律拒绝，还是只看解析后在不在 root 里？
 *      ★一律拒绝★，即使它指向 root 内部（`/repo/a.md` 也返回 absolute）。
 *      理由：这个函数的入参契约就是「仓库相对路径」。收到绝对路径说明
 *            调用方理解错了，早点报错比默默接受好。
 *      代价：调用方必须自己保证传相对路径。
 *      ⚠ 若改成「只看解析结果」：删掉 absolute 这个 kind，
 *        `/etc/passwd` 归 escapes-root —— 别保留一个描述形状的 kind。
 *
 * @param root      仓库根目录的绝对路径
 * @param candidate 待校验的路径（仓库相对）
 */
export function resolveInsideRoot(
  root: string,
  candidate: string,
): Result<string, PathError> {
  throw new Error(
    `resolveInsideRoot(${root}, ${candidate}) 还没实现 —— 契约已定，等实现`,
  );
}
