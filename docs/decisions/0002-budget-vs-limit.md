# 0002 · 领域词表第一条：上限 / 预算，以及 insufficient-budget

日期：2026-09 　状态：生效 　依据：[0001](./0001-layered-conventions.md)

## 背景

同一个概念在代码里有三个名字（2026-09 实测，重命名之前）：

```text
limit    51 处   LimitName / LoopLimits / LimitReached / LimitMode
budget    3 处   turn.ts 的 "budget-exhausted"
文档              ts-modern-train MAP 图 3 管 loop.ts 叫「预算计数器」
```

而 `LimitReached` 和 `budget-exhausted` **携带完全相同的三个字段**
（`limit` / `used` / `max`），即它们是同一个概念被写了两遍。

更糟的是：**两个名字都是事实错误。** 实跑：

```text
已用 3 / 上限 5，再要 3 个（原子拒绝）：
  loop.recordToolRuns → {"kind":"limit-reached","limit":"tool-runs","used":3,"max":5}
  turn.decide         → {"kind":"budget-exhausted","limit":"tool-runs","used":3,"max":5}
★used=3, max=5 —— 上限没被 reached，预算也没 exhausted。★
```

`tsc` / ESLint / 185 个测试 / 变异检查 **一个都发现不了**：
改名字不改行为，对变异测试而言是等价变异。

## 候选

```text
A  统一叫 limit          —— LimitReached 保留，turn.ts 改过来
B  ★统一叫 budget★       —— 概念叫预算，模块和类型都跟着改
C  ★两个词都留，但各给一个确定含义★
D  不动，写进词表当"已知同义词"
```

判据：**哪个名字在★所有情形★下都说的是事实**（不只在"刚好用光"那一种）。

## 决定

**选 C，并把错误名改准。**

```text
上限 limit    ★配置的那个数字★，静态          LoopLimits.maxToolRuns / LimitName
预算 budget   ★上限 + 已用★，会被消耗的状态    LoopBudget / createLoopBudget
不够 insufficient  请求的量 > 剩下的量        InsufficientBudget
```

A/B 都不过判据：`limit-reached` 和 `budget-exhausted` 在原子拒绝时都说错了事实。
D 不过 0001 的判据① —— 那就是本次漏掉它的原因。

改名清单：

| 旧                                 | 新                                                  |
| ---------------------------------- | --------------------------------------------------- |
| `LoopState` / `createLoopState`    | `LoopBudget` / `createLoopBudget`                   |
| `LimitReached` / `"limit-reached"` | `InsufficientBudget` / `"insufficient-budget"`      |
| `"budget-exhausted"`（turn.ts）    | 同上，★并复用 loop.ts 的类型★                       |
| `"invalid-tool-count"`（turn.ts）  | `"invalid-count"`，复用 `loop.ts` 的 `InvalidCount` |

顺带消掉三处重复：`InsufficientBudget`、`InvalidCount`、`isValidCount`
现在都只有一份，`turn.ts` 从 `loop.ts` 引入（依赖方向不变）。

## 后果

```text
得到   ① 错误名说的是事实，用户/日志读到的不再是误导
       ② turn.ts 和 loop.ts 不会再各自漂移 —— 同一个类型
       ③ 词表有了第一条，L6 有了归宿

代价   ★这是破坏性变更★：kind 字符串变了，将来有外部调用方就要发版本
       现在没有调用方，★所以现在改是最便宜的时刻★

验证   185 个测试全绿（只做机械改名，断言里的数值一个没动）
       六个文件覆盖率仍是 100%
       14 个变异体杀 13，唯一存活的是已知等价的 platform-path（Linux 上区分不了）

★什么信号出现要重新考虑★
  · 出现「上限本身会变」的需求（动态调额）—— 那时 limit 不再是静态的，这条要重写
  · 出现第二种预算（时间预算、token 预算），InsufficientBudget 的 limit 字段可能要拆
```
