# 0003 · 用例层配置改成 smart constructor + branded type

## 背景

`RunConfig` 有六个字段。`limits` 那三个数由 `createLoopBudget` 校验；
另外三个 —— `maxConcurrentTools` / `maxRetries` / `retryBaseMs` —— **一个都没校验**。

2026-09 实测出这件事的代价。修 bug 时用了 `Math.max(1, Math.min(上限, 个数))` 兜底，
对比没有兜底的版本，`maxConcurrentTools: 0` 会：

```text
width = 0  →  一个 worker 都不启动  →  结果数组留下空洞
           →  空洞流进 domain/input.ts  →  TypeError: Cannot read properties of undefined
```

**报错地点在领域层，和"并发配置"隔了三层。**

而领域层从阶段 1 起一直是「校验」派（`createLoopBudget` / `isValidCount` / `admitInput`
全部是「坏输入 → 明确失败」）。用例层这三个字段是整个项目唯一的例外。

## 候选

```text
① Math.max 兜底         最省事
                        代价：★把配置错误静默地变成一个能跑的值★，
                              0 被当成 1，没人知道配置写错了；和项目风格相反
② 在 run 开头校验        和 createLoopBudget 一致，返回 setup
                        代价：每次调用都校验一遍；run 的签名仍然收得下非法配置，
                              ★"忘了校验"这件事没有被类型挡住★
③ smart constructor
   + branded type       非法配置★构造不出来★，run 只收 ValidRunConfig
                        代价：见「后果」
```

判据是「错误在哪一层被发现」：①在没人发现，②在运行时，③在**编译期**。

## 决定

**选 ③。** `createRunConfig(raw): Result<ValidRunConfig, ConfigError>`，
`run` 只收 `ValidRunConfig`，而它带一个 `unique symbol` 品牌，只能由工厂产出。

`ValidRunConfig` 额外携带 `initialBudget: LoopBudget`。

这一点不是为了省一次调用，而是为了让 `run` 里**不再存在「上限非法」这条分支** ——
否则它会变成死代码：走不到、测不出、覆盖率永远缺一块。
`LoopBudget` 不可变（每个 `record*` 返回新对象），所以一份零值预算可以被任意多次 `run` 共用。

## 后果

```text
✅ run 的 setup 分支从「上限非法 | 输入非法」缩成「输入非法」，死代码消失
✅ 配置错误在 composition root 就报出来，报错地点 = 出错地点
✅ 三个字段的合法区间变成可测的东西（10 条用例）

⛔ ★有一条测试从此写不出来★：「上限非法 → run 返回 setup」。
   非法配置到不了 run 的门口。断言跟着规则搬到了 createRunConfig 那一层 ——
   和 ❸B 那次一模一样的位移。

⛔ ★品牌类型防手滑，不防蓄意★。实测：
     run(deps, raw, …)          → TS2345，拦住
     run(deps, raw as never, …) → ★0 errors，绕过★
   它挡的是"忘了校验"，不是"故意绕开"。

⛔ 每个调用点都要多一次 if (!cfg.ok)。composition root 里是一次；
   测试脚手架里 cfgWith 内部抛 —— ★脚手架的前置条件失败要当场炸★，
   不要悄悄跑下去。
```

**反悔信号**：如果配置字段涨到十几个、而且大多来自环境变量（阶段 6 之后），
一个平铺的 `createRunConfig` 会变成一长串 if。那时该换成 schema 校验（zod），
品牌保留，工厂内部换实现。

## 相关

- `0001-layered-conventions.md` —— 每一层用自己的原生机制
- `ts-modern-train/docs/language/11-structural-and-branded-types.md` —— 品牌类型的机制
- `ts-modern-train/docs/engineering/20-contract-levels.md` —— 这是把 L2（模块契约）往 L1（类型）推
