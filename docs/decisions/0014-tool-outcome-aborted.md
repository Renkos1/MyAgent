# 0014 · ToolOutcome 补 `aborted` 一格

## 背景

阶段 3 的契约套件跑变异（`pnpm mutate:contract`），**5 个存活的变异体全部指向同一处**：

```text
src/infra/fake/tools.ts:45  if (opts?.signal?.aborted === true)   条件、可选链、布尔字面量
src/infra/fake/tools.ts:46  return { kind: "failed", cause: "unknown" };   NoCoverage ×3
```

活下来的原因不是测试写漏了，是**契约根本没规定这件事**：
`ports.ts` 里 `ToolPort.run` 的文档只说了「不抛异常」，没说取消要返回什么。
于是 `FakeTools` 自己选了 `{ kind: "failed", cause: "unknown" }` ——
**实现替契约做了决定**，而契约测试因此无从断言。

ADR 0007 §⑨ 定的是「工具执行失败算什么」，它没有讨论取消。
本文不改 §⑨ 的任何一句，只补 §⑨ 没覆盖的那一格。

## 候选与决定

### ① 取消该返回什么

```text
候选   a  维持 { kind:"failed", cause:"unknown" }
       b  ★ToolOutcome 加一格 { kind:"aborted" }★
       c  契约明说「不规定，各实现自便」

判据   ★调用方对这两者的处理是不是同一套★（和 0006 §① 区分两种「停」同一把尺子）：
         记不记进错误率      失败记，取消不记
         该不该重试          失败可以，★取消重试等于无视用户按的停止★
         要不要告诉模型      失败要（「工具坏了，换个办法」），
                             取消不要 —— 循环本来就要结束了
       三项全不同 ⇒ a 会让调用方把三件事同时做错

       第二条判据是★可执行的★：契约测试能不能断言这一格。
       c 的代价当场可测 —— 那 5 个变异体永远活着，
       而它们在真适配器上对应的是「fs 的 AbortError 直接冒泡」

选择   b
代价   ToolOutcome 从 5 个 kind 变 6 个：renderOutcome 多一支，
       阶段 7 持久化时多一个枚举值。
       ★tsc 会替我们找出所有要改的地方★ —— 实测：加完这一格，
       Record<ToolOutcome["kind"], …> 当场点名两个文件，switch 点名一处
```

### ② 带不带 payload

```text
候选   a  ★{ kind:"aborted" }★                          只加一格
       b  { kind:"aborted"; sideEffect:"none"|"unknown" }  区分副作用

判据   「工具有没有可能★已经产生副作用★」——
       signal 在 run 之前就 aborted   一步都没跑，副作用 none
       signal 在 run 进行中 aborted   文件可能已经写了一半，副作用 unknown
       这就是[延迟阶梯](../../ts-modern-train/docs/MAP.md)图 6 的★第三态★，
       和 LlmError.aborted 是同一个洞

选择   ★a —— 这次只加一格★（本轮只做被要求的那一格，不顺手扩大）
代价   ★abort-before-start 和 abort-mid-run 分不开★，永久地分不开：
       压平之后的旧行★回填不了★

⏰ ★反悔信号（有期限，不是「有空再说」）★
   ★必须赶在阶段 7 第一次把 ToolOutcome 写进库之前重新考虑 b★。
   判据和根 README 那条「给 TurnOutcome 补『不知道』那一格」完全相同：
   过了那个点★代码成本不变★（还是一个字段），★数据成本变成无穷★。
   ⚠ 补的时候★测试要一起补★ —— 加字段不会让任何现有测试红（第七种假绿）
```

### ③ 契约测试怎么摆这一格

```text
问题   aborted 摆不出来 —— signal 是 run 的★参数★，不是端口的构造参数
选择   ToolStage 的返回值里连 opts 一起给回来
判据   「同一个套件要能跑真适配器」：真适配器同样只能靠 signal 摆出这一格

⚠ 另有一条★不能合并★的断言：
   「run 解析出这一格」问的是摆得出吗；
   「signal 已 aborted 时压过表里摆好的答案」问的是★取消优先级★。
   合并了就分不出「实现没看 signal」和「表里本来就没这条」。
   ⇒ 场景表里 aborted 那一格★故意复用 ok 的 call★（表里有答案），
     实现必须无视它。配一个表里没有的 call，这条断言就是零鉴别力
```

## 后果

```text
✅ 5 个存活变异体有了归属：契约补了，测试补了
✅ 取消和失败在类型上分开，调用方不会把「用户按了停止」记成错误
⛔ ★第三态仍然压平★，期限见 ②
⛔ ToolOutcome 和 LlmError 现在都有 aborted，★但语义深度不同★
   （前者只有一格，后者也只有一格）—— 两处要一起补，别只补一边
```

见红记录（红过才算数）：

```text
FakeTools 不再看 signal         → 契约套件 2 条红
renderOutcome 把取消说成失败    → runTurn 用例测试 1 条红
```

## 相关

- `0007-port-shapes.md` §⑨ —— 「失败是数据不是端口失败」，本文完全沿用
- `0007-port-shapes.md` §⑦ —— 取消怎么传（AbortSignal 现在就留）
- `ts-modern-train/docs/engineering/25-testing-the-uncertain.md` —— 契约套件怎么来的
- `ts-modern-train/docs/engineering/24-data-shape.md` —— ② 的「数据成本变无穷」判据
