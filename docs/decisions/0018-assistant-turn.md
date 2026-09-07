# 0018 · 历史里补 assistant 那一轮

> 阶段 4 映射层写不下去时撞出来的：**适配器造不出合法请求**。
> 这是 `0004`（历史归用例层、端口无状态）留下的口子，阶段 2 用 Fake 时看不见。

## 背景

供应商的线格式要求：工具结果必须回应**前一条 assistant 消息里的工具调用块**。

```text
线格式要求                          ADR 0004 之后历史里有的
─────────────────────────────      ──────────────────────
user      "docs 下有什么？"          ✅ { role: "user" }
assistant [工具调用 id=t1 ...]       ⛔ 没有这一格
user      [工具结果 id=t1 ...]       ✅ { role: "tool-result" }
```

`TurnInput` 只有 `user` 和 `tool-result` 两种角色，`runTurn` 也只 push 这两种。
所以适配器手上**凑不出**一个供应商会接受的请求。

为什么阶段 2 没发现：`FakeLlm` 不校验线格式，它只把 `history` 原样存进 `sent`。
**Fake 能跑通 ≠ 请求合法** —— 这是「用 Fake 换来确定性」这笔交易的账单。

## 候选与决定

```text
候选 A   适配器从 tool-result 的 id 反推重建 assistant 轮
候选 B   TurnInput 加 { role: "assistant"; content: unknown } 存供应商原样
候选 C   TurnInput 加 { role: "assistant"; calls: readonly ToolCall[] }
候选 D   适配器自己记住上一次的响应
```

判据两条，必须同时满足：

```text
① 凑得出合法请求吗
② 供应商的形状会不会漏进 app 层
```

```text
A   ⛔ 过不了①：工具调用的参数（dir / path / query）历史里没存，
       只有 id 和结果，重建不出来
B   ✅① ⛔② unknown 就是「供应商的形状」，端口白划了 ——
       app 层一旦装了供应商的原始块，换 provider 就要改 app
C   ✅① ✅② ToolCall 是端口自己的词汇，有 name / id / 参数，够重建；
       重建的动作留在适配器里
D   ⛔ 破坏「端口无状态」（ADR 0004 的核心）——
       无状态是「回退一轮重来」「编辑上一条重发」只换一个数组的前提
```

**决定：C。**

`runTurn` 在扣完工具预算、拿到 `calls` 之后，先把 `{ role: "assistant", calls }`
追加进历史，再追加工具结果。顺序是契约的一部分：**assistant 必须在它的
tool-result 之前**。

## 后果

```text
✅ 适配器能造出合法请求，映射层写得下去了
✅ 供应商的形状仍然不进 app 层 —— 重建 tool_use 块是适配器的活
✅ 历史仍然是纯数据，端口仍然无状态
⛔ ADR 0004 的「历史里只有 user 和 tool-result」那句话作废了。
   本 ADR 不改 0004（ADR 不改只作废），差异以本份为准
⛔ 改动打到了 9 个断言历史形状的现有用例 ——
   ★它们全红了，说明那批测试对历史形状真有鉴别力★，不是装饰
⛔ 只有 tool-requested 那一轮会 push assistant。模型直接回答（completed）时
   历史里没有 assistant 轮 —— 目前够用，因为那一轮之后循环就结束了。
   TODO(阶段 6): 多轮对话（用户接着问第二个问题）时这条会不够
```

## 相关

- `0004-history-ownership.md` —— 被本 ADR 补了一格；无状态那条仍然成立
- `0007-port-shapes.md` —— ToolCall 的形状
- `0011-use-case-orchestration.md` —— §⑥ 工具结果怎么进历史
- `0017-provider-meta.md` —— 同一轮映射层工作的另一半
- `ts-modern-train/docs/libraries/anthropic-sdk.md` 坑 6 —— 工具结果的分组要求
