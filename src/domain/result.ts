/**
 * 领域层的错误表达方式：失败是返回值的一部分，不是异常。
 *
 * 决策见 ts-modern-train 的 docs/03「架构决策清单」第 1 条：
 * 领域和用例层用 Result，边界层（HTTP / CLI）才转成异常和状态码。
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
