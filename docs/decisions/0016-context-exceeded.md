# 0016 · 上下文窗口撑满：第六个 kind 开在哪

> 阶段 4 开工侦察的产物。翻 `@anthropic-ai/sdk@0.124.0` 的 `.d.ts` 时发现
> `stop_reason` 有七个值，比官方文档正文多一个。
> 实测记录见 `ts-modern-train/docs/libraries/anthropic-sdk.md`。

## 背景

阶段 1 定 `TurnOutcome` 五个 kind 时，视野里没有真实供应商。接真模型前
先把线格式摊开对一遍，发现**五个 kind 装不下七个 `stop_reason`**：

```text
tool_use                       → tool-requested
end_turn                       → completed / empty
max_tokens                     → truncated
refusal                        → refused
stop_sequence                  → 我们不设 stop_sequences，理论不出现
pause_turn                     → 装不下（只在 server tool 时出现，本项目不用）
model_context_window_exceeded  → 装不下，而且这一支会真的发生
```

最后一支会真的发生，原因是**两把尺子量的不是同一个东西**：

```text
我们的预算单位   modelCalls 次数 + 输入字节数   domain/loop.ts、domain/input.ts
模型的上限单位   token
```

`runTurn` 每轮把全量 history 发出去（ADR 0004：端口无状态，历史归用例层），
工具结果不断追加。本地预算没超，模型那边先炸。
而「字节数 → token 数」的比例目前没有一手数据
（`ts-modern-train/docs/README.md` 待办里挂着，要等接上模型才量得到）。

## 候选与决定

### ① 它属于响应还是错误

```text
候选 A   放进 LlmError            和 401 / 429 / 超时同一类
候选 B   放进 LlmResponse         和 truncated / refused 同一类
```

**判据是端口自己写死的那一条**（`src/app/ports.ts` 的 `LlmPort.send` 注释）：

> Result 的错误分支表示「没问到模型」，不表示「模型说了坏消息」——
> 后者是 LlmResponse 的一个 kind。

`model_context_window_exceeded` 是 `stop_reason`，也就是 **HTTP 200**：
问到了，请求成功了，**输入 token 已经计费**。按这条判据，A 出局。

**决定：B。** `LlmResponse` 加一格，`TurnOutcome` 由 `KindsMatch` 连带加一格。

> NOTE: 起草时先按 A 走过一遍，是错的。发现方式是读 SDK 自己的注释 ——
> 那七个值全挂在 `stop_reason` 上，和 `max_tokens` 并排。

### ② 要不要复用 truncated

```text
候选 A   复用 truncated           一行映射就完事，不碰领域层
候选 B   新开 context-exceeded    碰领域层：TurnOutcome / AbortReason / decide
```

判据同样来自端口：**「按调用方要做什么分类」**。

```text
truncated          调大出参上限，或让模型接着写   → 重发同一份历史有希望
context-exceeded   必须砍历史                     → 重发同一份历史一定再炸
```

补救方式相反，合并就等于让调用方永远选错。**决定：B。**

代价是碰了阶段 1 的成果。但这个代价现在最小 —— 见 ③。

### ③ 为什么是现在，不是「以后再说」

和 `ts-modern-train` 待办里 `TurnOutcome` 补「不知道」那一格是同一条时机判据
（来自 `engineering/24-data-shape.md` 实测）：

```text
现在改    代码成本 = tsc 点名的点数（本次 4 处），数据成本 = 0
阶段 7 后 代码成本不变，数据成本 = 无穷 —— 压平后的旧行永远分不开
```

**决定：现在改。** 分界线是「第一次把 outcome 写进库」，不是「阶段 4 有空」。

### ④ LlmResponse 那一格带不带 partialText

```text
候选 A   带，和 truncated 对称
候选 B   不带，只留 kind
```

判据：撑满窗口之前模型已经生成了一部分，那部分和 `truncated` 的
`partialText` 地位完全一样（ADR 0006 §④：半句话不是答案，但留着给调用方展示）。
两个同构的东西给不同形状，以后一定漂移。

**决定：A。** 反悔成本低 —— 删字段是编译错误，每一处都会被点名。

### ⑤ refundable 的形状

`runTurn` 的 `refundable()` 原本是布尔表达式：

```typescript
return e.kind === "unavailable" || e.kind === "rejected";
```

它对 `LlmError` 按 kind 分派，但**没有穷尽性**。新 kind 默认落到 `false`
（不退预算），而那个默认值从来没人选过。

```text
候选 A   不改，记待办
候选 B   改成穷尽 switch（无 default）—— 新 kind 触发 TS2366
候选 C   改成 switch + assertNever + default
```

判据是**可执行的**：加一个 kind，跑 `pnpm verify`，看有没有信号。

```text
改之前   八道门全过、218 用例全绿、退出码 0        零信号
改之后   tsc 报 TS2366 Function lacks ending return statement
```

C 比 B 多一个运行时不可达分支，要 `v8 ignore`，还会被 Stryker 报成存活变异体
（`ts-modern-train/docs/experience.md` §十 那类假阳性）。同文件的 `toOutcome`
已经是 B 的写法。**决定：B。**

## 后果

```text
✅ 调用方能分辨两种「内容不完整」，补救方式不会选错
✅ LlmError 从此有守卫：再长新 kind，tsc 当场点名
✅ 数据成本锁在 0 —— 赶在阶段 7 写库之前
⛔ 碰了阶段 1 的领域层。decide 的分支从 5 支变 6 支，
   AbortReason 从 5 支变 6 支
⛔ IMPORTANT: 这次改动 pnpm verify 全绿，218 个用例一个没红 ——
   覆盖率从 turn.ts 100% 掉到 90%（第 96 行），但 verify 不读覆盖率阈值。
   ★测试要人补★，机器不会替你发明一个 kind
⛔ pause_turn 和 stop_sequence 仍然没有归宿。本项目不用 server tool、
   不设 stop_sequences，所以适配器把它们压成 LlmError 的 malformed
   （「我们的代码要改」）。TODO(阶段 4)：真接上之后确认它们确实不出现
⛔ 「字节数 → token 数」的比例还是空的 —— 在拿到它之前，
   这条错误路径只能被动触发，没法预防
```

## 相关

- `0006-turn-decision-shape.md` —— §④ 截断算哪一类；本 ADR 是它的续
- `0011-use-case-orchestration.md` —— §② 预算什么时候扣、什么时候退
- `0004-history-ownership.md` —— 为什么每轮发全量历史（本 ADR 的成因）
- `0007-port-shapes.md` —— §② KindsMatch 那道编译期门禁
- `ts-modern-train/docs/libraries/anthropic-sdk.md` —— 七个 stop_reason 的实测
- `ts-modern-train/docs/experience.md` §三 —— 加 kind 的信号强弱取决于有没有守卫
