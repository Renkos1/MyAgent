import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { isSecret, secretOf } from "../../src/domain/secret.ts";

/**
 * 这个模块的观察面有四个，四个都要有自己的断言。
 *
 * IMPORTANT: 这里不是「测一个函数的返回值」，是**测一个值在四种协议下的样子**。
 * 只测 `expose()` 的话，`toJSON` 整个删掉测试也不会红 —— 那正是 CLAUDE.md
 * 协作第 2 条最后一行说的「一窝存活变异体全挤在没被断言的输出上」。
 */
const REAL = "sk-live-DO-NOT-LEAK-4242";

describe("secretOf：四条输出路径都不许漏", () => {
  it("console.log 的那条（util.inspect）", () => {
    const s = secretOf(REAL);
    expect(inspect(s)).toBe("[redacted]");
    expect(inspect({ token: s })).toBe("{ token: [redacted] }");
  });

  it("JSON.stringify 的那条", () => {
    const s = secretOf(REAL);
    expect(JSON.stringify({ token: s })).toBe('{"token":"[redacted]"}');
  });

  it("模板串和 String() 的那条", () => {
    const s = secretOf(REAL);
    // NOTE: 直接写 `${s}` 会被 ESLint 的 restrict-template-expressions 挡下来
    //       （"Invalid type Secret<string> of template literal expression"）——
    //       意外收获：类型层先挡了一道，模板串这条路要显式转才走得通。
    //       所以 toString 是兜底，不是第一道防线。lint 管不到的地方（比如
    //       第三方库内部、JSON 之外的序列化）才轮到它。
    expect(String(s)).toBe("[redacted]");
    expect(`key=${String(s)}`).toBe("key=[redacted]");
  });

  it("expose 是唯一取得到真值的路", () => {
    expect(secretOf(REAL).expose()).toBe(REAL);
  });
});

describe("secretOf：值不在对象图里（挡住泄露的是闭包，不是 hook）", () => {
  it("自有属性里没有真值", () => {
    const s = secretOf(REAL);
    // NOTE: 只有三个函数 —— 品牌是类型层的，运行时不存在
    expect(Object.getOwnPropertyNames(s).sort()).toEqual([
      "expose",
      "toJSON",
      "toString",
    ]);
  });

  it("showHidden + depth:null 也挖不出来", () => {
    const dumped = inspect(
      { token: secretOf(REAL) },
      { showHidden: true, depth: null },
    );
    expect(dumped).not.toContain(REAL);
  });

  it("TRAP: 只有 toJSON 的那种写法会漏 —— 这里演一遍它错在哪", () => {
    // IMPORTANT: 这是**反例**，不是被测代码。留着是因为它是最容易想到的实现，
    //            而它在 JSON.stringify 下看起来完全正确。
    const naive = { raw: REAL, toJSON: () => "[redacted]" };
    expect(JSON.stringify({ token: naive })).toBe('{"token":"[redacted]"}');
    expect(inspect({ token: naive })).toContain(REAL);
  });
});

describe("isSecret", () => {
  it("认得出真的", () => {
    expect(isSecret(secretOf(REAL))).toBe(true);
  });

  it("三个 hook 缺一个就不算", () => {
    expect(isSecret({ expose: () => REAL, toJSON: () => "x" })).toBe(false);
  });

  it("不是对象的一律 false", () => {
    expect(isSecret(REAL)).toBe(false);
    expect(isSecret(null)).toBe(false);
    expect(isSecret(undefined)).toBe(false);
  });
});
