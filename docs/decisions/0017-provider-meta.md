# 0017 · 七个 stop_reason 各占一格 + 供应商元数据分开存

> 阶段 4 映射层的契约决定。`0016` 定了 `context-exceeded` 那一格，
> 这一份把剩下两个 `stop_reason` 也落位，并回答「丢掉的信息怎么办」。

## 背景

`@anthropic-ai/sdk@0.124.0` 的 `StopReason` 有七个值（实测见
`ts-modern-train/docs/libraries/anthropic-sdk.md`）。`0016` 之后端口有六格，
还剩两个无处安放：

```text
pause_turn      server tool 跑太久，供应商主动暂停；线格式上可续
stop_sequence   撞上自定义停止序列
```

本项目**两个都不该出现**：不用 server tool，也没设 `stop_sequences`。

另一条独立的问题：压成端口语义时丢掉的东西（`stop_details.category`、
原始 `stop_reason`），阶段 7 第一次写库之后就永远回填不了了
（同 `engineering/24-data-shape.md` 的时机判据）。

## 候选与决定

### ① 两个「不该出现」的 stop_reason 归哪

```text
候选 A   都压进 LlmError 的 malformed —— 「我们的代码要改」
候选 B   各开一格
```

判据：**真出现的时候，错误信息说不说得清是哪一个**。

A 省事，代价是排障时只知道「适配器读不懂」，不知道是暂停还是停止序列 ——
而这两者的根因完全不同（前者说明有人开了 server tool，后者说明请求参数被改过）。

**决定：B。** `LlmResponse` / `TurnOutcome` 各加两格 `paused` 和 `stop-sequence`，
`KindsMatch` 保证两边同步，`decide` 各判一支 `aborted`。

代价：领域层的 `AbortReason` 从 6 支变 8 支；两支在正常运行中**永远不会被执行**，
覆盖率天生缺，变异测试也杀不掉。这是已知的，不是漏测。

### ② decide 对 paused 判 aborted 而不是 continue

线格式上 `pause_turn` 是可续的：把 assistant 那一轮原样发回去就能接着跑。
但 `Decision` 的 `continue` 带 `toolRuns`，而 `isValidCount(0)` 会把 0 判成
`invalid-count`（ADR 0006 §③）——「说要调工具却给 0 个」。

```text
候选 A   判 aborted
候选 B   给 Decision 加一支 resume
```

判据：**我们有没有续的路径**。没有 —— `runTurn` 的循环每轮都从 `send` 开始，
没有「把上一轮响应原样发回去」的动作。B 会造出一个没人走的分支。

**决定：A。** 反悔信号：哪天真要用 server tool，这一条要重开。

### ③ 丢掉的信息存哪

```text
候选 A   不存
候选 B   只在 malformed 上带一个 raw: string
候选 C   LlmResponse 每一格都带 ProviderMeta
```

判据：**阶段 7 第一次写库那天能不能回填**。A 那天永远分不开。

**决定：C。**

```typescript
export type ProviderMeta = {
  readonly stopReason: string | null;
  readonly refusalCategory: string | null;
};
```

⚠ **①做完之后，这一条的收益变小了，写下来免得后人以为它一直很值**：
`paused` / `stop-sequence` 各开一格之后，kind 反过来能确定 `stopReason`
（`end_turn` → `completed` 或 `empty` 也可由「有没有文本」还原）。所以
`stopReason` 现在只剩一个用途：**出现我们没见过的 stop_reason 时，语义走
`malformed`，原文留在这里**。真正不可还原的只有 `refusalCategory`。

保留 C 而不退回 B 的理由：B 把元数据挂在错误上，而 `refusalCategory` 属于
**成功响应**（refusal 是 200）。两个字段挂两个地方，以后一定漂移。

### ④ SAFETY：元数据里放什么

两个字段都只放**闭集里的短标识符或 null**，绝不放自由文本 ——
同 `ToolOutcome.cause` 和 `PathError` 的那条不变量（ADR 0007 §⑨）。
日志脱敏规则阶段 8 才定，在那之前放进来的自由文本会原样进日志。

### ⑤ 自己造响应的地方怎么填

Fake、组合根、测试都没有供应商。导出一个常量：

```typescript
export const NO_META: ProviderMeta = {
  stopReason: null,
  refusalCategory: null,
};
```

候选是「把 meta 设成可选」。否决理由：`exactOptionalPropertyTypes` 下可选字段的
比较很容易变成「两边都没有就算过」，那是零鉴别力 —— 契约套件的
`scenarios.ts` 已经为同一条理由用 `"n/a"` 占位而不是可选字段。

## 后果

```text
✅ 七个 stop_reason 全部有归宿，排障时说得清是哪一个
✅ 语义（kind）和元数据（meta）分开：语义决定调用方做什么，元数据只为回填
✅ 数据成本锁在 0 —— 赶在阶段 7 写库之前
⛔ LlmResponse 从 6 格变 8 格，AbortReason 从 6 支变 8 支
⛔ paused / stop-sequence 两支永远不被执行 ⇒ 覆盖率缺、变异体存活。已知，非漏测
⛔ 38 处构造点要补 meta（2 处 src + 8 处 scripts + 28 处 test）——
   NO_META 把每处压成一个 token，但改动面确实铺开了
⛔ IMPORTANT: 补完 meta 之后 429 个用例全绿 —— ★没有一个测试断言过 meta★。
   新加的两个 kind 也一样没有测试。测试要另外补
```

## 相关

- `0016-context-exceeded.md` —— 第六格，本 ADR 是它的续
- `0006-turn-decision-shape.md` —— §③ isValidCount 为什么挡 0；§④ 截断算哪一类
- `0007-port-shapes.md` —— §② KindsMatch；§⑨ 闭集不放自由文本
- `0018-assistant-turn.md` —— 同一轮映射层工作的另一半
- `ts-modern-train/docs/libraries/anthropic-sdk.md` —— 七个 stop_reason 的实测
- `ts-modern-train/docs/engineering/24-data-shape.md` —— 「算不出来的必须存」
