# 领域词表

> **一个概念一个词。** 这份表是 L6 语义层的契约 ——
> 分层的完整说明见 `ts-modern-train/docs/engineering/20-contract-levels.md`。
>
> ⚠ **改这份表 = 改契约。** 作废一个拼法要写进下面「已作废」一节，不要静默改。

## 为什么需要它

`tsc`、ESLint、185 个测试、变异检查 —— **一个都发现不了「一个概念两个名字」**，
因为那不是行为问题，是语义问题，而这些门禁量的全是行为。

实测（2026-09，重命名之前）：

```text
limit    51 处   LimitName / LoopLimits / LimitReached / LimitMode
budget    3 处   turn.ts 的 "budget-exhausted"
文档              ts-modern-train MAP 图 3 管它叫「预算计数器」
⇒ 一个概念三个名字，全绿
```

## 核心词

| 中文     | 英文           | 指什么                              | ★不是什么★                    | 代码里                                                  |
| -------- | -------------- | ----------------------------------- | ----------------------------- | ------------------------------------------------------- |
| **上限** | `limit`        | ★配置的那个数字★，静态、不会变      | 不是「还剩多少」              | `LoopLimits.maxToolRuns` / `LimitName` / `InvalidLimit` |
| **预算** | `budget`       | ★上限 + 已用★，会被消耗的运行时状态 | 不是那个数字本身              | `LoopBudget` / `createLoopBudget`                       |
| **不够** | `insufficient` | 请求的量 > 剩下的量                 | ⛔ 不是「用光」也不是「触顶」 | `InsufficientBudget`                                    |
| 轮次     | `turn`         | 一次「问模型 → 拿到响应」           | 不是「一次工具调用」          | `TurnOutcome` / `decide`                                |
| 裁决     | `decision`     | 一轮结束后该继续/结束/中止          | 不是「结果」（那是 Result）   | `Decision`                                              |
| 字素簇   | `grapheme`     | 人眼里的一个字                      | 不是码点，不是 UTF-16 单元    | `Graphemes` / `measure(t,"grapheme")`                   |

## 允许的同义词（避免检查器误伤）

```text
max      ✅  只作为★字段名前缀★用：maxToolRuns。它是 limit 的一种写法，不是新概念
count    ✅  「个数」，和预算无关：toolCount / InvalidCount
size     ✅  「字节数」，size.ts 的领域词，和上限无关
state    ⚠  ★避免★。以前 LoopState 就是含糊在这里 —— 它是预算，不是泛指的"状态"
```

## ★已作废的拼法★

| 作废                   | 换成                    | 为什么                                                    |
| ---------------------- | ----------------------- | --------------------------------------------------------- |
| `LoopState`            | `LoopBudget`            | 它就是预算，"State" 说了等于没说                          |
| `createLoopState`      | `createLoopBudget`      | 同上                                                      |
| `"limit-reached"`      | `"insufficient-budget"` | ★事实错误★：`used=3, max=5` 一次要 3 个也会报它，上限没到 |
| `"budget-exhausted"`   | `"insufficient-budget"` | 同一个概念的第二个名字；且同样是事实错误（没 exhausted）  |
| `"invalid-tool-count"` | `"invalid-count"`       | 和 `loop.ts` 的 `InvalidCount` 同形状同含义，两个名字     |

实测（`docs/decisions/0002`）：

```text
已用 3 / 上限 5，再要 3 个：
  loop.recordToolRuns → {"kind":"limit-reached","limit":"tool-runs","used":3,"max":5}
  turn.decide         → {"kind":"budget-exhausted","limit":"tool-runs","used":3,"max":5}
★两个名字，同样的三个字段，而且两个名字都说错了事实。★
```

## 怎么用

```text
写新代码前   要引入一个新名词 → 先查这里有没有已有的词
改名字       ★先在这里作废旧拼法★，再改代码 —— 顺序反了就会漏掉一处
写文档       中文用左列，代码标识符用第二列，不要混
```

## 相关

- `docs/decisions/0002-budget-vs-limit.md` —— 这份表第一条的 ADR
- `ts-modern-train/docs/engineering/20-contract-levels.md` —— L6 为什么只能靠词表
- `ts-modern-train/docs/engineering/17-naming.md` —— 命名的三个维度（词表是它的上一层）
