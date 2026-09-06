# 0008 · 路径解析：仓库内 / 仓库外怎么判

> 原来在 `src/domain/path.ts` 文件头（61 行注释 / 95 行文件）。2026-09 外移。

## 背景

模型和用户会给出路径。`resolveInsideRoot(root, candidate)` 把它解析成仓库内的绝对路径，
越界一律拒绝。**纯函数**：不 stat、不 readFile、不碰 fs，只做字符串和路径运算 ——
符号链接和文件存不存在归 IO 适配器。

这是一片**有编号的战场**：路径穿越是 CWE-22，被踩过几万次。

## 候选与决定

```text
① root 本身合法吗
   选择   合法。"." 和 "docs/.." 都返回 root 的绝对形式
   理由   list_files(".") 是有意义的调用，没道理拒绝

② 返回绝对还是相对路径
   选择   ★绝对★ —— 调用方拿到就能交给 fs，不用再拼一次 root
   代价   给模型看的时候要自己转回相对，否则★泄露宿主机目录结构★

③ 尾斜杠保留还是归一化
   选择   ★保留★。"docs/" → "/repo/docs/"
   理由   调用方能据此看出「调用者认为这是个目录」
   代价   下游要接受同一位置的两种字符串形态

④ Windows 反斜杠
   选择   ★当分隔符处理★，先统一换成 / 再解析
   理由   开发在 Windows、运行在 Linux，同一个字符串不能有两种语义
   代价   Linux 上一个真的叫 `a\b.txt` 的文件将无法访问。可接受

⑤ 错误要不要带上出问题的路径
   选择   ★不带★。PathError 只有 kind
   理由   ★这个值来自模型/用户，直接进日志就是把攻击载荷原样落盘★
   补偿   调用方手里本来就有入参，需要就自己拼

⑥ 绝对路径一律拒绝，还是只看解析后在不在 root 里
   选择   ★一律拒绝★，即使它指向 root 内部（/repo/a.md 也返回 absolute）
   理由   这个函数的入参契约就是「仓库相对路径」。收到绝对路径说明调用方
          理解错了，早点报错比默默接受好
   代价   调用方必须自己保证传相对路径
   反悔   若改成「只看解析结果」：★删掉 absolute 这个 kind★，
          /etc/passwd 归 escapes-root —— 别保留一个描述形状的 kind
```

## SAFETY：三条不能动的实现约束

```text
① 不能用 abs.startsWith(root)
   那是字符串前缀比较，不懂分隔符 —— "/repo-evil" 也以 "/repo" 开头（CWE-22）
   正确判据：要走出 root，从 root 出发的第一步必然是 ".."

② 反斜杠替换必须在 isAbsolute / resolve ★之前★
   否则 "..\..\x" 在 POSIX 下会被当成一个含反斜杠的文件名，而不是穿越

③ 绝对路径判断必须在 resolve ★之前★
   resolve 遇到绝对路径会丢弃左边所有参数，root 就完全失效了
```

## 后果

```text
✅ 28 个测试用例，其中★3 个★（前缀陷阱）承载对付 startsWith 漏洞的全部鉴别力
⛔ 平台差异（path.posix vs path）在 Linux CI 上测不出来 ——
   2026-09 改由 ESLint no-restricted-syntax 在 src/domain 禁掉非 posix 用法，
   不必等阶段 11 的 Windows matrix
```

## 相关

- `ts-modern-train/docs/collaboration.md` —— 28 选 3 那个数字的出处
- `ts-modern-train/docs/libraries/node-path.md` —— path API 的坑
