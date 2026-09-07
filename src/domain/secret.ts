/**
 * 秘密的容器 —— 一个只能被显式取出、不会被顺手打印出来的值。
 *
 * @remarks
 * 阶段 5 的题目里，秘密和普通配置的区别只有一条：**它一旦被看见就永久损坏**。
 * key 进了日志、进了错误上报、被 `console.log(config)` 打在终端上，
 * 补救办法都不是删掉那行输出，而是去供应商后台吊销重发。
 *
 * IMPORTANT: 真正挡住泄露的是**闭包**，不是下面那三个 hook。
 * 值只活在 {@link secretOf} 的参数作用域里，不是这个对象的自有属性 ——
 * 所以 `util.inspect(x, { showHidden: true, depth: null })` 也挖不出来。
 * 三个 hook 只负责把输出变成 `[redacted]` 而不是 `{}` / `[object Object]`，
 * 它们是**可读性**，不是安全边界。
 *
 * TRAP: 只写 `toJSON` 是不够的，而它恰好是最容易想到的那一个。
 * 2026-09 实测（Node 24），把值当自有属性存、只加 `toJSON`：
 *
 * ```text
 * JSON.stringify        {"token":"[redacted]"}          干净
 * console.log(obj)      { toJSON: [Function], raw: 'sk-REAL-KEY' }   泄露
 * ```
 *
 * 三条输出路径各走各的协议：`JSON.stringify` 认 `toJSON`，模板串和 `String()`
 * 认 `toString`，而 `console.log` / `util.format("%s", x)` 两个都不认，
 * 只认 `Symbol.for("nodejs.util.inspect.custom")`。
 * NOTE: 「有几种可观察输出，就要有几种被改坏过」——
 * 这个模块的观察面是 4 个（三条打印路径 + expose），测试里逐个红过。
 */

/** 品牌。IMPORTANT: 只存在于类型层，运行时没有这个属性，挖不到。 */
declare const secret: unique symbol;

/** `console.log` 和 `util.format("%s", x)` 唯一认的那个 hook。 */
const INSPECT = Symbol.for("nodejs.util.inspect.custom");

/** 所有打印路径统一吐这个。SAFETY: 别在里面拼进任何真值的片段，长度也不行。 */
const MASK = "[redacted]";

/**
 * 一个包起来的秘密。
 *
 * @remarks
 * 取值只有 {@link Secret.expose} 一条路，而且它的名字是故意难听的 ——
 * `grep -rn "\.expose()"` 应该能一眼数完全项目取真值的地方。
 * 阶段 8 接 pino 时，redact 规则要覆盖的正是 `.expose()` 的下游，不是这里。
 */
export type Secret<T> = {
  /** IMPORTANT: 类型层的品牌，运行时不存在。 */
  readonly [secret]: true;
  /** 取出真值。SAFETY: 调用点越少越好，别为了省事在上游就 expose。 */
  readonly expose: () => T;
  /** 模板串和 `String()` 走这条。 */
  readonly toString: () => string;
  /** `JSON.stringify` 走这条。 */
  readonly toJSON: () => string;
  /** `console.log(obj)` 和 `util.format("%s", x)` 走这条。 */
  readonly [INSPECT]: () => string;
};

/**
 * 把一个值包成秘密。
 *
 * @param value - 真值。IMPORTANT: 它之后只存在于闭包里，不是返回对象的属性
 * @returns 打印安全的容器
 *
 * @example
 * ```ts
 * const token = secretOf("sk-abc123");
 * console.log({ token });        // { token: [redacted] }
 * JSON.stringify({ token });     // {"token":"[redacted]"}
 * `${token}`;                    // "[redacted]"
 * token.expose();                // "sk-abc123"
 * ```
 */
export function secretOf<T>(value: T): Secret<T> {
  return {
    expose: () => value,
    toString: () => MASK,
    toJSON: () => MASK,
    [INSPECT]: () => MASK,
  } as Secret<T>;
}

/**
 * 这个值是不是一个 {@link Secret}。
 *
 * @remarks
 * NOTE: 判据是三个 hook 齐不齐，不是品牌 —— 品牌运行时不存在。
 * 用途只有一个：门禁测试里断言「配置对象上该是秘密的那几格真的是秘密」。
 *
 * @param v - 任意值
 * @returns 是则收窄成 `Secret<unknown>`
 */
export function isSecret(v: unknown): v is Secret<unknown> {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Partial<Secret<unknown>>;
  return (
    typeof o.expose === "function" &&
    typeof o.toJSON === "function" &&
    typeof o[INSPECT] === "function"
  );
}
