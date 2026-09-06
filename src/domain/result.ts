/**
 * 领域层的错误表达方式：失败是返回值的一部分，不是异常。
 *
 * 决策见 ts-modern-train 的 docs/03「架构决策清单」第 1 条：
 * 领域和用例层用 Result，边界层（HTTP / CLI）才转成异常和状态码。
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** 包一个成功值。窄到 `Result<T, never>`，让调用方那边的 E 自己推断。 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** 包一个失败值。窄到 `Result<never, E>`，理由同 {@link ok}。 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
