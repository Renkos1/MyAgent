import type { Result } from "./result.ts";

/**
 * 路径校验失败的原因。
 *
 * ⚠ 这几个 kind 是提议，不是定论 —— 契约由你定。
 *   增删都行，改完告诉我，我按你最终的版本写实现。
 *   分太细：以后合并困难。分太粗：调用方区分不了该怎么处理。
 */
export type PathError =
  | { readonly kind: "empty" }
  | { readonly kind: "absolute" }
  | { readonly kind: "escapes-root" };

/**
 * 把模型/用户给的一个路径，解析成仓库内的绝对路径；越界一律拒绝。
 *
 * ★这是纯函数★：不 stat、不 readFile、不碰 fs，只做字符串和路径运算。
 * 符号链接、文件存不存在，都不归它管（那是阶段 2 的 IO 适配器）。
 *
 * @param root      仓库根目录的绝对路径
 * @param candidate 待校验的路径
 */
export function resolveInsideRoot(
  root: string,
  candidate: string,
): Result<string, PathError> {
  throw new Error(
    `resolveInsideRoot(${root}, ${candidate}) 还没实现 —— 阶段 1 轮 1 只交契约`,
  );
}
