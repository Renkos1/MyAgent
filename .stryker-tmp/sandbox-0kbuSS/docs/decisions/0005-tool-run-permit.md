# 0005 · 用「许可证类型」把「先扣预算再跑工具」变成编译期约束

## 背景

两件事在同一个地方出问题：

**一、丢失的保证。** 阶段 1 的 `decide` 在返回 `continue` 之前会检查下一轮的模型额度，
契约原文是「跑完工具还要再问一次模型，问不起就**别跑那些工具**」。
0002 之后预算检查从 `decide` 搬走，这条保证**跟着丢了**，于是出现「工具白跑」：
花了 IO、花了工具额度，结果没有额度再问模型，那些结果没人看。

**二、注释会说谎。** 「先扣预算，再跑工具」这条顺序当时只写在一行注释里：

```ts
// 契约③：跑工具之前扣工具预算，不够一个都不跑
const spent = recordToolRuns(...);
```

2026-09 往这个文件里埋 bug 时，把这一行**连注释一起**搬到了 `runTools` 后面。
`check-contracts` / tsc / lint / dependency-cruiser **四道门禁全绿** ——
锚点注释只保证「契约③存在」，不保证「这行真的在跑工具之前」。

## 候选

```text
① runTurn 里预检下一轮模型额度      最省事
                                   代价：★把 0002 刚消掉的重复谓词请回来★
② recordToolRuns 加一个「预留一次
   模型调用」参数                   检查合并进领域层
                                   代价：改领域签名，阶段 1 的测试要动
③ ★许可证类型★                     reserveToolRuns 返回带品牌的凭证，
                                   runTools 必须收它才肯跑
                                   代价：见「后果」
```

判据：**「顺序」这种约束能不能不靠注释来保证。**①②只解决保证丢失，不解决注释说谎。

## 决定

**选 ③。**

```ts
export type ToolRunPermit = {
  readonly next: LoopBudget;
  readonly count: number;
  readonly [permit]: true;      // unique symbol，只活在类型里
};

export function reserveToolRuns(state, count): Result<ToolRunPermit, …>
```

`runTools(deps, cfg, _permit: ToolRunPermit, calls, opts)` —— 第三个参数只需要存在。
拿不到许可证就跑不了工具。

模型额度这里**只探测不扣**（下一轮开头的 `recordModelCall` 才真扣），
探测复用 `recordModelCall` 的实现而不是复制它的判断 —— 复制出来的两份谓词迟早漂移。

## 后果

```text
✅ 「工具白跑」不可能再发生：额度不够时 tools.seen 是空的（新增 1 条测试）
✅ ★顺序由编译器保证★，实测两种写错法都被拦住：
     忘了传许可证        TS2554: Expected 5 arguments, but got 4
     先跑工具再拿许可证   TS2448: Block-scoped variable 'permit' used before its declaration
✅ 报错语义正确：工具跑不了时报 model-calls —— 原因是「跑完问不起」

⛔ ★保护范围只到模块内★。runTools 不导出，许可证挡的是
   「这个文件里未来的我」，不是外部调用者。而 bug 恰好就发生在那里。

⛔ 多一个只为编译期存在的参数，函数体不用它（`_permit`）。
   读代码的人会问「这参数干嘛的」—— 靠注释解释，回到了注释。
   区别在于：★这次注释说谎的话，编译器仍然拦得住★。

⛔ TRAP: 构造许可证时★不能写 `[permit]: true`★。`declare const permit` 是纯类型
   声明，运行时没有这个绑定，当计算属性键用会 ReferenceError。
   tsc / lint / arch 全绿，只有真跑测试才炸。品牌只活在类型里，构造用 as 断言 ——
   和 createLoopBudget 一致。★和「参数属性在 strip-only 下跑不了」是同一族坑★：
   类型层面的东西被当成值来用。
```

**反悔信号**：如果出现第二处需要同类许可证的地方（比如「先校验路径再读文件」），
就该把这个手法抽象成一个通用的 `Permit<Tag>`，而不是各写各的。

## 相关

- `0003-validated-run-config.md` —— 同一个手法（品牌类型）的另一次使用
- `ts-modern-train/docs/engineering/21-comment-conventions.md` —— 坑 1 讲的就是这次的注释说谎
- `ts-modern-train/docs/language/11-structural-and-branded-types.md` —— 机制
