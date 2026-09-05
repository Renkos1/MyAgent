# 0007 · 端口的形状：LlmPort / ToolPort 的九个决定

> 内容原来堆在 `src/app/ports.ts` 的文件头（117 行注释 / 215 行文件）。
> 2026-09 按 `ts-modern-train/docs/engineering/21-comment-conventions.md` 外移。

## 背景

端口是「用**领域的词汇**写下我需要外界做什么」。这个文件里没有一行实现，
它存在的唯一目的是**让箭头方向反过来**：app 依赖接口，infra 依赖 app。
门禁在 `.dependency-cruiser.cjs` 的 `app-不许碰-infra`。

阶段 1 的 `TurnOutcome` 已经替这些决定定死了一半 ——
端口不是新发明的东西，是**领域已经开口要的东西**。

## 候选与决定

### ① 端口返回什么形状

```text
候选   a  只返回 TurnOutcome（那五个 kind）
       b  TurnOutcome + text + toolCalls 三个字段并列
       c  ★payload 塞进 kind 里★
判据   「不可能的组合能不能写出来」—— 和 0006 §① 同一把尺子
       completed 必须带 text（不然答案从哪来），tool-requested 必须带 calls，
       empty 两个都没有 → b 会让「completed 但 text 是 undefined」写得出来
选择   c
代价   ★app 和 domain 出现两个平行的联合★（LlmResponse / TurnOutcome）。
       两份平行结构会各自漂移 —— loop.ts / turn.ts 已经踩过。对策见 ②
```

### ② 两个平行联合怎么保证不漂

```text
选择   ★类型层断言★ KindsMatch：要求两边的 kind 集合互相包含
       任一边加了 kind 而另一边没加 → tsc 直接红
判据   这是★结构性标记★不是注释（engineering/19 的 A/B 分类）
代价   多一个只为编译期存在的常量，运行时是死代码
```

实测两个方向各红一次：

```text
只给 app 加 kind     ports.ts: TS2322 Type 'true' is not assignable to type 'never'
                     + toOutcome 的 switch TS2366 缺 return
只给 domain 加 kind  ports.ts: TS2322
                     + turn.ts 的 assertNever TS2345
```

**三道独立门禁**，任何一边动了都拦得住。

### ③ 网络失败算哪一类

```text
选择   ★端口失败，走 Result<_, LlmError>★，decide 看不见它
理由   decide 的输入是「模型那边发生了什么」；HTTP 500 是「我们没能问到模型」
       —— 连一轮都没发生，没有可裁决的东西
代价   用例层要写两层判断（先 result.ok，再 decide）
```

### ④ LlmError 怎么分类

```text
选择   ★按调用方要做什么分，不按 HTTP 状态码分★
       unavailable（等一下再试）/ rejected（重试没用）/ aborted / malformed
判据   沿用 path.ts 的同一条：kind 描述失败的★原因★，不描述失败的形状。
       429 和 503 在代码里是同一件事，就该是同一个 kind
```

`malformed` 是**适配器自己的失败**：它没能把供应商响应压成五个 kind。
单独一个 kind，因为它意味着**我们的代码要改**，不是等一下再试。

### ⑤ 历史谁维护

**用例层拥有全部历史，端口无状态。** 完整的候选和反悔过程见
`0004-history-ownership.md`（原方案是「端口收增量」，反悔信号提前触发）。

### ⑥ 流式和非流式怎么共存

```text
选择   ★两个方法并存★：send 返回 Promise，stream 返回 AsyncIterable
理由   阶段 6 才做 SSE，但★方法签名是难回退的★ ——
       以后把 Promise 改成 AsyncIterable，所有调用点都要改
代价   适配器要实现两遍；两条路径的错误处理容易不一致
       （阶段 3 的契约测试要同时打这两条）
```

### ⑦ 取消怎么传

```text
选择   ★现在就留 AbortSignal★，即使阶段 2 没人传
理由   roadmap 阶段 6 验收明写「Ctrl-C 后服务端真的停止调用模型」，
       验证方式是★去 provider 后台看 token 用量★ ——
       信号断在中间是查不出来的，只能一路传到底
同类   决策 3 的 actor 口子。★留口子便宜，改签名贵。★
```

### ⑧ 工具名是 string 还是联合

```text
选择   ★联合类型 ToolName★
⚠      模型返回的是★任意字符串★，联合类型不会自己出现 ——
       ★收窄的动作发生在适配器里★，和 ① 「压成五个 kind」是同一个动作。
       收不进来的名字 → LlmError.malformed
收益   ToolCall 按 name 判别，每个工具的参数各自定型：
       read_file 拿不到 dir，list_files 拿不到 query
```

### ⑨ 工具执行失败算什么

```text
选择   ★正常返回值，不是端口失败★（所以 run 不返回 Result）
理由   领域规则里「工具失败的处理策略」有一项是★告诉模型★ ——
       要喂回给模型的东西，本来就是数据
```

**SAFETY**: `failed` 的 `cause` 是**闭集，不是自由文本**。
路径是模型/用户给的值，塞进自由文本就会原样进日志。
同一条不变量：`path.ts` 的 `PathError` 只带 `kind`，不带那个路径。
日志脱敏规则阶段 8 才定 —— **在那之前不许放自由文本进来**。

## 后果

```text
✅ 不可能的组合写不出来；两个平行联合由编译器钉住
✅ 端口无状态，可并发，历史可观察
⛔ 适配器要实现 send 和 stream 两遍，一致性靠阶段 3 的契约测试
⛔ ★KindsMatch 是运行时死代码★ —— 覆盖率会缺这一行，已用 void 标注
```

## 相关

- `0004-history-ownership.md` —— ⑤ 的完整反悔过程
- `0006-turn-decision-shape.md` —— ① 沿用的是它的判据
- `ts-modern-train/docs/engineering/19-markers-and-fitness-functions.md` —— ② 的 A/B 分类
