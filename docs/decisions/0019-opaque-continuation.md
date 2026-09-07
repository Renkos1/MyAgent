# 0019 · 不透明续传令牌：thinking 块怎么过端口

## 背景

阶段 4 接真模型，第一次看到真实响应的 content 块：

```text
块类型        ["thinking","tool_use","tool_use"]
thinking 块   字段：["type","thinking","signature"]
```

`signature` 存在的唯一理由是**发回去时验签**。而 ADR 0018 定的 `TurnInput`
的 assistant 那一格只存 `ToolCall[]`，适配器按领域词汇**重建**这条消息 ——
thinking 块因此被丢掉。

ADR 0018 的推理链没有错，它塌在一个隐含前提上：

> 「assistant 那一轮里，供应商产生的东西可以由端口的词汇完全重建。」

thinking 块打破了它：**造不出来**（带签名）、**丢不得**（对方要验）、
**在领域词汇里没有对应物**（思考过程不是端口关心的语义）。

实测（2026-09，`scripts/probe-roundtrip.ts`，DeepSeek 兼容端点）：

```text
① 丢掉 thinking 再发回   成功  stop_reason="end_turn"
② 原样带回               成功  stop_reason="end_turn"
```

**这个供应商不验签。** 但 Anthropic 官方在 extended thinking + 工具调用同时
开启时要求原样带回，且 `signature` 字段的存在本身就说明有人会验。

## 候选

**A. `TurnInput` 的 assistant 格加一个不透明字段**
代价：供应商的形状（虽然包在 `readonly unknown[]` 里）漏进 app 层，
ADR 0018「不许漏形状」的约束被削弱；用例层要搬运一个它不懂的东西。

**B. 适配器内部按 id 存一张表，用例层完全不知情**
代价：**端口不再无状态**，破坏 ADR 0004。用例层换了历史数组
（回退一轮、编辑上一条重发）之后，适配器的表就是旧的。

**C. 不管它，赌供应商不验签**
代价：换回 Anthropic 官方就 400，而且**只在多轮工具调用时才炸** ——
单轮冒烟测不出来。

## 决定

**选 A。**

判据是「破坏哪条约束更贵」：B 破坏的无状态是 `runTurn` 全部重试和回退逻辑的
地基；A 削弱的「不许漏形状」目的是防止 app 层**依赖**供应商细节，而用
`readonly unknown[]` 包住的搬运工不构成依赖 —— 用例层读不出内容，也没有
分支可以建立在它上面。

C 被排除的理由是它的失败模式：不在冒烟里出现，只在多轮时出现，而且换 provider
才炸。这正是能力矩阵要挡住的那一类。

字段名 `opaque`，两处对称：

```ts
LlmResponse  { kind: "tool-requested"; calls; opaque?: readonly unknown[] }
TurnInput    { role: "assistant";      calls; opaque?: readonly unknown[] }
```

适配器侧按**排除法**收集：`tool_use`（能从 `ToolCall` 重建）和 `text`
（端口明确丢弃，ADR 0017 的 A6）之外一律进 `opaque`。
将来供应商新增块类型，这里不用改。

还原时不透明块排在 `tool_use` **前面** —— 实测供应商发来的就是这个顺序。

## 后果

**得到的**

- 换 Anthropic 官方不会因为丢 thinking 而 400。
- 供应商将来新增任何「必须原样带回」的块类型，这条通路已经在了。

**付出的**

- `unknown` 穿过了 app 层。ESLint 的类型感知规则在这个字段上帮不了忙，
  唯一的保护是 TSDoc 里那句「读它、判断它、根据它分支，都是 bug」。
- 历史数组不再是纯领域数据：序列化到磁盘（阶段 8 之后）时，
  `opaque` 里是供应商特定的结构，跨 provider 重放会失败。

**重新考虑的信号**

- `opaque` 里的东西开始被用例层读 —— 说明它不该是不透明的，该有一格真名字。
- 出现第二种「必须原样带回」的东西且两者语义不同 —— 一个 `unknown[]`
  装两种语义时该拆。
