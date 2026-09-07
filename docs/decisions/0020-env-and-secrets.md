# 0020 · 配置与秘密：env 怎么读、秘密怎么装、门禁摆在哪

## 背景

阶段 4 结束时，读环境变量的地方有六处 —— 六个脚本各抄了一份完全一样的
`env()` helper，`src/` 一处不读。这个安排在当时是对的（`llm.ts` 的注释写着
「读环境变量会让构造过程依赖进程状态，而那是阶段 5 的题目」），但它欠着四件事：

1. **形状没有被 parse 过。** `process.env` 的类型是
   `Record<string, string | undefined>`，`"3"` 不是 `3`、`""` 和 `undefined`
   是两种缺失。tsc 在这里帮不上忙，因为它看到的确实就是 `string | undefined`。
2. **key 是一个裸 `string`。** `console.log(config)` 会把它原样打出来，
   而秘密的性质是**一旦被看见就永久损坏** —— 补救不是删那行输出，是去
   provider 后台吊销。
3. **模型名没人校验。** 阶段 4 实测 `validatesModelName: "no"`：
   模型名打错，供应商照常回答，请求被别的模型接走，没有任何信号。
4. **没有任何东西拦「key 进了 git」。**

约束：`app/config.ts` 已经有一套成熟的校验风格（smart constructor + 品牌类型，
ADR 0003），不能推倒；`.env` 的加载用 Node 内置的 `--env-file-if-exists`，
不引入 dotenv。

## 候选

### D1 · parse 用什么

| 候选                               | 代价                                       |
| ---------------------------------- | ------------------------------------------ |
| ① 全 Zod，`createRunConfig` 也重写 | 丢掉品牌类型「构造不出非法值」的编译期保证 |
| ② 只在 env 边界用 Zod              | 仓库里两套校验风格并存                     |
| ③ 全手写，不引入 Zod               | 自己实现 issue 聚合和 coerce               |

### D2 · 谁读 `process.env`

`src/app/env.ts` / `src/infra/env.ts` / 只在组合根读。

### D3 · 读不出来时的失败形态

`throw` / `Result` / `process.exit`。以及一个更贵的子问题：
**报第一个错，还是一次报全。**

### D4 · 模型名怎么校验

闭集（字面量联合）/ 正则 / 只 warn。

### D5 · gitleaks 摆在哪

本地装二进制 / 只进 CI / 两边都跑且装不上就红 / 走 git hooks（阶段 13 才有）。

### D6 · 秘密的类型形状

裸 `string` / `Secret<T>` 包装 / 等阶段 8 用 pino redact 统一处理。

### D7 · 环境变量前缀

沿用 `SMOKE_*` / 改名 `AGENT_*`。

## 决定

```text
D1  ② 只在 env 边界用 Zod
D2  ② src/infra/env.ts 读并 parse，组合根接到 createRunConfig
D3  ② Result 到边界，边界打印全部问题后 exit(1)
D4  ① 闭集（src/infra/anthropic/models.ts）
D5  ③ 本地和 CI 都跑，装不上要红不要 skip
D6  ② Secret<T>（src/domain/secret.ts）
D7    改名 AGENT_*，ANTHROPIC_* 保留为低优先级兜底
```

**D1 的判据是「输入形状是不是已经被 tsc 保证了」**，不是「哪个工具更好」：

```text
app/config.ts   输入 RunConfig     形状已被 tsc 保证
                -> Zod 只买到「把 tsc 已知的事再运行时说一遍」
                -> 手写 smart constructor，产出品牌类型
infra/env.ts    输入 Record<string, string | undefined>
                -> 形状真未知，Zod 买到的是 parse
```

两套风格并存是**有判据的并存**，不是没统一。判据在上面这四行。

**D6 的实测结论（2026-09，Node 24）**：真正挡住泄露的是**闭包**，不是 hook。
值只活在 `secretOf` 的参数作用域里，不是返回对象的自有属性，所以
`util.inspect(x, { showHidden: true, depth: null })` 也挖不出来。三个 hook
只负责把输出变成 `[redacted]` 而不是 `{}` / `[object Object]`。

TRAP: 只写 `toJSON` 是不够的，而它恰好是最容易想到的那一个 ——
`JSON.stringify` 干净了，`console.log(obj)` 照样吐出真值。

意外收获：ESLint 的 `restrict-template-expressions` 会挡下
`` `${secret}` ``（"Invalid type Secret<string> of template literal expression"）
—— **类型层先挡了一道**，`toString` 是兜底不是第一道防线。

**D5 的实测结论（2026-09，gitleaks v8）**：第一次见红**失败**了。
默认规则主要靠**标识符的名字**触发，不是靠值长得像不像密钥：

```text
const apiKey = "<48 位随机>"       抓到   generic-api-key
const banana = "<48 位随机>"       漏掉   同一个值，只换了变量名
aws_access_key_id = AKIA...EXAMPLE 漏掉   官方示例值在白名单里
```

⇒ 它是**兜底**，不是「有它就安全了」。真防线是 `.gitignore` + `Secret<T>` +
代码里根本不出现 key 这三样。

## 后果

**得到**：

- 缺变量时启动就失败，且**一次报全**（Zod 的 `safeParse` 天然聚合，不用自己写）
- 模型名打错在启动时红，而不是被别的模型静默接走
- 配置对象进日志 / 进错误上报时不含 key
- `.env` 进 git、历史里有 key、暂存区里有 key，三种情形各有一道会红的门

**放弃**：

- 仓库里两套校验风格。新人要读 `infra/env.ts` 的头注释才知道该用哪套
- 加一个新模型名要改代码。这是要的信号，不是麻烦
- `pnpm verify` 现在依赖一个非 npm 的二进制。换机器第一次 verify 会红 ——
  **这是 D5③ 的设计，不是缺陷**

**什么信号出现时重新考虑**：

- ~~`Secret<T>` 的 `.expose()` 调用点超过 5 处~~ -> 见下面的「补记 ①」
- `KNOWN_MODELS` 每周都要改 -> 闭集的成本超过了收益，换成「闭集 + 一个显式
  的 `AGENT_ALLOW_UNKNOWN_MODEL=1` 逃生口」
- gitleaks 的误报让人开始想关掉这道门 -> 加 `.gitleaksignore`（按 fingerprint，
  不按路径），不要放宽规则
- 阶段 8 接 pino 时，redact 规则要覆盖的是 `.expose()` 的**下游**，
  不是 `Secret` 本身 —— 那时回来把两者的分工写清楚

## 补记

> 追加，不改上面的正文（ADR 不改只作废；这是**漏记和写错的数**，
> 不是决定变更，同 ADR 0008 的处理）。

### ① 「`.expose()` 超过 5 处」这条信号写的时候没数，当天就被触发

收工时数出来是 **7 处**：`src/index.ts` 1 处，6 个脚本各 1 处。
六个脚本那一处全是同一个形状 —— 在组合根把真值交给 SDK。

那是**边界**，不是「往上游漏」。数量从来不是判据，位置才是。改成：

```text
判据   .expose() 的结果不许流进任何输出语句（console / 日志 / 响应体）
       且 src/ 里只许出现在组合根
门禁   test/gates/stage5.test.ts 「门禁一」两条，都见过红
```

顺带去掉了 `scripts/smoke.ts` 打印「key 长度 + 前 4 位」那一行。
它想回答「我用的是哪个 key」，而同一段里的 `sourceOf` 已经答得更准
（值来自哪个变量名）；前 4 位对带固定前缀的 key 几乎不含信息，
却是一条真的泄露路径。

### ② 阶段 5 的三道防线里，有两道处在「没人验证验证者」的位置

`check-secrets.ts` 和 `ci.yml` 都不在行为用例的射程里。
实测：故意埋进去的 4 个 bug，**3 个落在这个盲区**，`pnpm verify` 一声不吭。

补的是 `test/gates/stage5.test.ts` —— 三道**适应度函数**，测的是源码和配置
的形状不是行为。IMPORTANT: 它们的鉴别力有上限，摁得住「这一行被改掉了」，
摁不住「换个写法绕过去」。和 gitleaks 一样是兜底。

TRAP: 写门禁三时第一版直接对 yaml 全文断言「不许出现 `fetch-depth: 非 0`」，
被自己那行解释性注释（"默认是 fetch-depth: 1"）判红 ——
**尺子量到了尺子上的刻度**。和 `check-notation` 当初必须写 `\u` 转义、
`check-contracts` 第一版误报，是同一类错。

### ③ 「同一套机制，测一个就以为覆盖了」

`readEnv` 的 missing/invalid 映射有四个字段共用，原来只测了 `BASE_URL`。
把 `MODEL` 那一格的两条对调之后，两条消息**仍然不同** ——
只断言「不一样」的测试照样绿。改成对每个字段断言**内容**，
并且加一条反向断言：缺失的话里不许出现非法那一半的措辞。

## 未兑现的

`pnpm eval` 的退出码仍然恒 0（ADR 0013 §④）。解除条件是量出基线通过率 p0，
阶段 4 挂着、阶段 5 也没做（人拍板跳过，理由是它不阻塞阶段 5 的任何验收）。
**这是第三次顺延，写在这里免得它变成没人记得的债。**
