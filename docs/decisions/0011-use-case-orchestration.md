# 0011 · 用例层的调用顺序：runTurn 的七个决定

> 原来在 `src/app/runTurn.ts` 文件头。2026-09 外移。
> `runTurn` 不定新规则 —— 规则全在 domain 里，**它只决定调用顺序**。

## 候选与决定

### ① 函数的形状

```text
候选   a  runConversation(question) → Promise<RunOutcome>，内部 while 跑到底
       b  step(state) → Promise<{next, event}>，调用方驱动循环
       c  ★async generator★：中间事件 yield，最终结果 return
判据   ★谁需要看到中间过程★
         阶段 6  SSE 要把每个 token 推给前端
         阶段 8  每一步的耗时/成本要落日志
         阶段 3  测试要断言「第 2 轮调了 read_file」
       a 中间过程埋在函数里，要靠回调穿透；b 调用方要正确驱动循环，驱动错了没人拦
选择   c
代价   · ★for await 拿不到 return 值★（那是 AsyncGenerator 的第二个类型参数）
         调用方要么手动 next() 到 done，要么用 collect 助手
       · 提前 break 会触发 generator 的 return()，清理要写在 finally 里
```

### ② 模型预算什么时候扣

```text
候选   a  send 之前扣    b  send 成功之后扣    c  ★之前扣，没花钱时退回★
判据   ★一次失败的 HTTP 请求，算不算花了钱★ —— 看供应商那边有没有产生 token
选择   c
       rejected    401/400，请求没被受理          → 退
       unavailable 429/503/连不上，没进到生成      → 退
       aborted     我们自己叫停，模型已经在生成了   → 不退
       malformed   模型答了，只是我们读不懂        → 不退
```

**TODO(阶段 4)**：`unavailable` 里混着「连接超时」和「生成到一半断线」，
后者其实花了钱。接真模型时要用 provider 后台的用量对账。

### ③ 工具预算什么时候扣

`decide` 返回 `continue` 之后、跑工具之前，由 `reserveToolRuns` 的许可证保证。
同时确认跑完还问得起模型。完整决策见 `0005-tool-run-permit.md`。

### ④ 两个预算都不够时报哪个

**这条和阶段 1 的答案相反，而且不是选出来的，是被 ② 推出来的。**

```text
阶段 1 的 decide 写的是「近的先查」：工具预算先于模型预算
但 ② 要求模型预算在★每轮开头★扣（send 之前），
而工具预算只能在 decide 说 continue 之后扣
  ⇒ ★顺序被时间轴钉死了，选不了★

现在的语义：模型额度先耗尽 → 报 model-calls，连问都问不起
判据仍是原来那条「哪个描述了用户实际拿到的东西」：
问都没问出去，说「工具跑不完」是错的
```

**后果**：推翻了 `turn.test.ts` 里「两个额度都不够 → 报 tool-runs」那条断言。
10 条测试的去向记在 `turn.test.ts` 开头，也见 `0006` §③。

### ⑤ 工具怎么跑

```text
候选   a  串行    b  Promise.all 全并行    c  ★并行但有上限★
判据   工具都是本地文件 IO，并行的收益不一定大；
       但一个失败了其他还跑不跑完、AbortSignal 怎么传给 n 个、日志顺序怎么排
选择   c —— maxConcurrentTools 由配置给，且必须 >= 1（见 0003）
约束   ★事件按请求顺序发，不按完成顺序★，否则日志没法对账
       一批里有失败不影响其他 —— 工具失败是数据（0007 §⑨），不是异常
```

### ⑥ 工具结果怎么进上下文

```text
候选   a  直接塞进请求，不过 admitInput
       b  过 admitInput，和用户输入同一个 mode
       c  ★过 admitInput，两个 mode 不同★
判据   read_file 的结果就是一个文件的全部内容 ——
       maxInputBytesPerItem 存在的全部理由就是它。a 等于把这条领域规则架空
选择   c
       用户输入   reject   —— 你自己打的字太长，该当场告诉你
       工具结果   truncate —— 文件就是大，截断喂进去好过整轮失败
约束   ★截断这件事要告诉模型★，否则它会拿半个文件当全部来回答
```

### ⑦ 返回什么

```text
选择   ★四个顶层 kind★，对齐 Decision 的形状
         done     模型答完了
         aborted  ★领域拒绝★（预算 / 内容不可信）—— 我们的规则挡下来的
         failed   ★端口失败★（问不到模型）—— 外界的问题
         setup    输入本身进不来
判据   aborted 和 failed 是两类完全不同的事，调用方的处理也不同
       三个都带 budget：阶段 8 的成本核算要它
变更   2026-09：setup 原来还包含「上限非法」，改成 ValidRunConfig 之后
       那一支不可能发生了，见 0003
```

## 后果

```text
✅ 中间过程可观察 → 阶段 6 的 SSE、阶段 8 的日志、阶段 3 的断言共用同一个出口
⛔ ④ 是被 ② 推出来的，不是选的 —— ★两个决定的交互产生了第三个决定★，
   这类"推论出来的契约"最容易在后续改动里被无意推翻
⛔ ⑥ 的 truncate 会让模型看到半个文件。「告诉模型」目前是往内容里拼一行
   「[已截断]」—— TODO(阶段 4)：真模型上要验它是否真的注意到了
```

## 相关

- `0003-validated-run-config.md` —— ⑤ 的并发上限、⑦ 的 setup 收缩
- `0005-tool-run-permit.md` —— ③ 的完整决策
- `0004-history-ownership.md` —— ⑥ 之后历史怎么攒
