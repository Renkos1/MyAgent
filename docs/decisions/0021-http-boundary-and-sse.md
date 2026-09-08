# 0021 · HTTP 边界与 SSE：线格式、失败怎么表达、取消传到哪

## 背景

阶段 5 结束时，这个 agent 只有一个入口：`pnpm dev` 跑 `src/index.ts`。
所有失败都是**自己的代码**或 **provider** 的失败 —— 两者都会以某种形式出声
（抛异常、返回 `Result`、tsc 点名）。

阶段 6 引入的不是「一个 HTTP 层」，是**第一个我们控制不了的对端**：
它会在任何时刻走人，而且**走的时候不报错**。开工前把 `node:http` 的 SSE
实测了七组（Node v24.20.0，输出在
ts-modern-train 的 `docs/libraries/node-http-sse.md`），三条硬约束：

```text
① 头一发出去，状态码就定死了      writeHead 之后再失败，改不成 500
② 分块边界 ≠ 事件边界             一次 write 不等于一次 read，两个方向都成立
③ 流没有「正常结束」这个信号       res.end() 和被人拔网线，客户端看到的完全一样
```

第三条决定了本文一半的内容：**「说完了」必须由我们自己造一个信号**，
否则截断会被当成成功 —— 那正是 ADR 0015 处理过的第三态，
只是这次它每天都会发生（每一次用户关页面）。

约束：`runTurn` 已经是 async generator（ADR 0011），事件形状现成；
`ToolOutcome.aborted` 已经带 `sideEffect`（ADR 0015），模型那一半还没有。

## 候选

### D1 · 流式和非流式怎么摆

① 只有流式端点，非流式让客户端自己收集 ② 只有非流式，流式以后再说
③ 两个端点，**同一个用例层**，非流式是把事件收集起来
④ 两个端点，两条实现路径

### D2 · 流开始之后才失败，怎么表达

① `event: error` 事件然后 `end()` ② 直接 `destroy()` socket
③ 两者都要（可恢复的发事件，不可恢复的掐 socket）

实测两者在客户端的形状（这就是判据，不是偏好）：

```text
/error-ev  写 event: error 再 end   →  读循环★正常结束★，能拿到 code
/destroy   socket 掐掉             →  读循环抛 TypeError: UND_ERR_SOCKET
/silent    直接 end，什么都不说     →  读循环★正常结束★  ← 和成功同形
```

### D3 · 客户端断开时，那一轮的 outcome 是什么

① 复用现有的 `aborted`，不区分 ② 对齐 ADR 0015，给 `LlmError.aborted`
加 `sideEffect: "none" | "unknown"` ③ 新加一格 `kind: "client-gone"`

### D4 · `req` / `res` 传到哪一层为止

① 传进用例层 ② 只把 `res` 传进去 ③ 传到 handler 为止，
用例层收 DTO + `AbortSignal` + `emit` 回调

判据是可执行的：**用例层的测试需不需要造一个 `http.ServerResponse`**。

### D5 · 长连的寿命

① 不设上限 ② 只设整条请求 ③ 只设单次上游调用 ④ 两层都设

实测：`server.requestTimeout` 默认 300000ms，但它量的是「收完请求」，
**掐不到已经开始的响应** —— 长连没有内置上限，不设就是没有。

## 决定

```text
D1  ③ 两个端点，同一个用例层
    POST /chat        SSE 流式
    POST /chat/sync   非流式 JSON = 把同一批事件收集起来
    ★不许有第二条实现路径★ —— 两条路径是两份 bug，回放测试还要录两遍

D2  ② destroy socket，不发 error 事件
    ⇒ ★前提：成功路径必须发终止事件★（event: done）。
      不发就等于把截断当成功（不变量③），这条前提破了 D2 就不成立

D3  ② 对齐 ADR 0015：LlmError.aborted 加 sideEffect: "none" | "unknown"
    请求发出前断开 = none，发出后断开 = unknown
    ⇒ runTurn 的 refundable() 从布尔表达式改成穷尽 switch ——
      现在两种取消被写死成同一种，加一格不会让任何测试红（假绿第七条）

D4  ③ req/res 传到 handler 为止
    handler 解构出 DTO + AbortSignal + emit，用例层不认识 http
    ⇒ 「node:http → Hono」那道双向门的前提保住了

D5  ④ 两层：整条请求 300s，单次上游调用 60s
    用 AbortSignal.any([客户端断开, 整条超时, 单次超时]) 合并
    ⇒ ★每请求一个 AbortController★，见下面 SAFETY
```

## SAFETY

**① 事件注入 —— 载荷一律 `JSON.stringify` 之后再插。**
`data:` 后面直接拼模型输出，一个 `\n` 就能截断事件，
一个 `\n\ndata: ` 就能**伪造一个事件**。模型输出里可以出现任意字符，
而模型读的是仓库里的文件 —— 文件内容是用户可控的。实测：

```text
写   data: 第一行\n第二行\n\n   →  收 data="第一行"，★「第二行」被静默丢掉★
```

违反的后果：客户端解析出一个我们从没发过的事件（同 CRLF 注入那一类）。

**② 取消信号不许跨请求共享。** `AbortController` 是熔断丝不是开关：
`abort()` 之后 `signal.aborted` 永远为真。实测把它提到模块作用域之后，
一个客户端断开 → 另一个请求被连坐 → **之后新来的请求 0 个 token**，端点报废。

**③ 错误体不许带内部信息。** 状态码之外只给闭集里的 `code`，
不透 provider 的原始消息、不透路径、不透 key（CLAUDE.md 第④类字符串：
最终用户看的字符串，阶段 6 起不许硬编码）。

## 后果

**得到**：

- 「客户端断开后服务端真的停止调用模型」这条验收**能进测试**：
  本地假上游数 token —— 不接线 12 个，接线 2 个（实测）
- 截断不会被当成成功：成功有 `event: done`，失败是 socket 断
- 用例层仍然只认 DTO，Hono 换得掉，测试不用造 http 对象

**放弃**：

- **旁观者吃同一个信号**：客户端只知道「断了」，不知道是崩溃、是 429、
  还是上游超时 ⇒ 重试策略只能保守
- 非流式端点的延迟 = 整轮时间，没有中间反馈（这是它的定义，不是缺陷）
- 两个超时数字要各自见红一次，测试要能控制时间

**什么信号出现时重新考虑**：

- 阶段 9 实测浏览器 `EventSource` 对 socket 断开**自动重连** ->
  D2 的代价会从「分不清原因」升级成「反复重试」，那时改成 D2③
- 单次对话稳定超过 60s -> 不是调大超时，是回去读 roadmap 决策清单第 7 条
  （该转异步了）
- `/chat/sync` 出现第二条实现路径的苗头（哪怕只是一个 if）-> D1 已经破了
- 阶段 9 决定用浏览器的 `EventSource`（**只能发 GET，不能自定义头**）->
  `POST /chat` 的形状要改成 GET + query，或者前端改用 fetch streaming。
  两条都不难，但要在写前端**之前**决定，不是写到一半发现

## 补记

### ① 起草时把 `refundable()` 的现状写错了

D3 那条原话是「`refundable()` 从布尔表达式改成穷尽 switch」。**它已经是穷尽
switch 了**（ADR 0011 那轮就改过，TSDoc 里还写着为什么）。写错的原因是照抄了
ts-modern-train 待办里的旧描述，没去读代码。

真正的风险和那句话说的不是一回事，而且更隐蔽：

```text
加一个新 kind      有守卫的联合会让 tsc 点名           -> 有信号
给已有的一格加字段  构造点被 tsc 点名（实测 3 处），
                   但**消费点一个都不会红** —— refundable 只 switch kind，
                   加了 sideEffect 之后它照样编译、照样返回原来的值
```

⇒ 所以 D3 落地时真正要人做的是**改消费点并补测试**，不是改函数形状。
实测：`aborted` 那条用例原来只有一条，补成两条（none / unknown 各一）之后，
把判据写反才会红。

### ② 掐 socket 会把客户端还没读走的数据一起丢掉

D2 起草时写下的代价是「客户端分不清崩溃、429 和超时」。实测又多一条：

```text
服务端写了 4 个事件 -> res.destroy() -> 客户端一个都没收到
（Node v24.20.0 + undici；客户端稍慢一点读，前面的全丢）
```

换成 FIN（`res.socket.end()`）也一样 —— 提前结束的响应体，undici 会连同
已缓冲的部分一起丢弃。⇒ **失败路径下「已经流出去的部分答案」不可靠**，
阶段 9 的客户端不能拿它当数据用。这条不推翻 D2，但它是 D2 的真实价格。

### ③ 状态码的方向 D1 没定，事后补在这里

D1 定的是线格式，没定「端口错误 → HTTP 状态码」。落地时填了一张表，而这张表
**填反了不会有任何信号**：四格都在（类型层满意），只是值错了。判据补记如下：

```text
unavailable  503   四格里唯一带 retryAfterMs 的一格，
                   而 Retry-After 的定义挂在 503 上
rejected     502   401/403/请求本身不合法 —— 重试没用，
                   说 503 等于叫客户端白等一轮
malformed    502   对面答了、我们读不懂，坏的是网关这一侧
aborted      504   还有人在听的取消只可能是我们自己超时
```

⇒ 现在有一条 `it.each` 顶着（`test/infra/httpChat.test.ts`），判据写在每一行的
用例名里 —— 因为「哪个码对」不是查手册查得出来的，是这四格的语义决定的。

## 相关

- [0011](./0011-use-case-orchestration.md) —— runTurn 的事件形状
- [0015](./0015-aborted-side-effect.md) —— ToolOutcome 的第三态，D3 照它对齐
- [0019](./0019-opaque-continuation.md) —— 不透明令牌，`/chat` 的续传用它
- ts-modern-train `docs/libraries/node-http-sse.md` —— 本文所有实测输出的出处
