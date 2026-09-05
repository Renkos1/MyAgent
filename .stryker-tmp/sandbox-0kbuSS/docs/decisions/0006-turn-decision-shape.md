# 0006 · 一轮结束时的判定：TurnOutcome / Decision 的形状

> 内容原来堆在 `src/domain/turn.ts` 的文件头（105 行注释 / 159 行文件）。
> 2026-09 按 `ts-modern-train/docs/engineering/21-comment-conventions.md` 外移。
> **决定是快照，不该跟着代码一起被改。**

## 背景

`decide` 要回答：这一轮结束了，该继续、该收工，还是该中止？

关键的区分是**两种"停"**：

```text
预算耗尽      我们★强制★停的     → 失败，用户没拿到答案
模型说做完了   模型★主动★停的     → 成功，用户拿到了答案
```

两者都表现为「循环停了」。**如果返回类型让它们长得一样，失败就会被当成功报给用户。**

## 候选与决定

### ① TurnOutcome 的形状

```text
候选   a  两个字段并列：hasToolRequest: boolean + stopReason
       b  ★判别联合★，把"有没有工具请求"和"为什么停"合并成一维
判据   两维的组合有一半是不可能的：
         · 输出被截断时，工具请求的 JSON 多半残缺，用不了
         · 供应商拒绝生成时，不可能同时有工具请求
         · "正常说完了"和"还要调工具"互斥
       判别联合的价值就是让★不可能的组合写不出来★
选择   b —— 五个 kind：tool-requested / completed / truncated / refused / empty
代价   适配器要负责把供应商响应压成这五个之一，★压错了领域层看不出来★
```

具体供应商的字段叫什么、有哪几个取值，**阶段 4 接真模型时实测**。
领域层只建模「有哪几类」，不建模「叫什么」。

### ② Decision 的形状

```text
候选   a  Result<Continue, AbortReason> —— 用错误分支表示中止
       b  ★三个顶层 kind★：continue / done / aborted
判据   成功和失败是调用方的两条不同代码路径
选择   b —— 让它们成为两个 kind，就没法把 aborted 顺手当成功处理
代价   调用方每次都要 switch 三个分支
```

### ③ 判定顺序（同时成立时报哪个）

```text
1. completed                 → done，★即使预算刚好用光★
2. truncated/refused/empty   → aborted
3. tool-requested            → 查 toolCount 合法性，合法就 continue

判据   ★哪个描述了用户实际拿到的东西。★
       模型答完了，用户就是拿到了答案 —— 这时报"达到轮次上限"是误导。
       模型还要继续而我们不让，用户什么也没拿到 —— 那才是失败。
```

**2026-09 变更：预算检查从这里搬走了。** 原来 `decide` 里写着
`state.toolRuns + toolCount > maxToolRuns`，和 `loop.ts` 的 `recordToolRuns`
**逐字相同** —— 同一条规则两处实现；而且 `decide` 先查过之后，
`recordToolRuns` 的 `InsufficientBudget` 分支永远走不到（死代码）。

现在是「谁扣预算谁检查」，`decide` 只判 outcome 的类别。代价：

```text
· 「近的先查」（工具先于模型）不再由 decide 保证，迁到用例层
  —— 后来发现它和「模型预算 send 前扣」冲突，见 0005 和 runTurn 契约④
· decide 不再需要 LoopBudget，签名少一个参数，所有调用点要改
· ★10 条测试受影响★：6 条搬家、4 条变成恒真被删（记在 turn.test.ts 开头）
```

**反悔信号**：用例层出现第二个调用 `decide` 的地方，而两处的预算顺序写得不一样。

### ④「输出被截断」算哪一类

```text
选择   ★aborted★。半句话不是答案，交给用户等于骗他
对照   size.ts 的「截断成空 = 非法」：同一类问题、同一个答案，但理由不同 ——
       那里是"骗调用方"，这里是"骗用户"
代价   那半句话拿不到。★但没丢信息★ —— outcome 本来就在调用方手里，要展示自己取
```

### ⑤ 空响应（没内容也没工具请求）算什么

```text
选择   ★aborted★。再调一次是同样的输入，大概率同样的结果 —— 这是★活锁★
代价   判成 continue 的后果是★静默的★：循环空转到轮次上限才停，
       花光全部预算换一个失败
```

### ⑥ 要不要动状态

```text
候选   a  状态转换：返回一个带「已终止」标记的新状态
       b  ★纯谓词★：只读不写
判据   「已终止」需要跨轮次记住吗 —— ★不需要★，循环停了就是停了，
       没有"下一轮"会来读这个标记（和 input.ts 判 recordInputBytes 用的是同一条）
选择   b
代价   ★这次选了谓词，和 loop.ts 反过来。★
       decide 说 aborted 而调用方继续循环，没有任何东西拦得住。
       loop.ts 选状态转换是因为它是循环★里的一步★；
       这里是循环的★出口★ —— 出口拦不住不肯走的人。
```

### ⑦ 为什么返回 Decision 而不是 Result

```text
选择   Decision 没有错误分支
理由   ★aborted 是一个有效的裁决，不是"decide 失败了"。★
       decide 永远能给出答案。
       ★「函数失败」和「函数报告了一个失败」是两回事。★
```

## 后果

```text
✅ 不可能的组合写不出来（判别联合）
✅ 成功和失败混不了（两个顶层 kind）
⛔ 适配器压错 kind 时，领域层完全无感 —— 这一层的正确性由契约测试守（阶段 3）
⛔ decide 是谓词不是转换，★出口约束不了不肯走的调用方★
```

## 相关

- `0005-tool-run-permit.md` —— 预算检查搬走之后丢的那条保证怎么找回来
- `ts-modern-train/docs/language/07-zod-and-narrowing.md` —— 判别联合
