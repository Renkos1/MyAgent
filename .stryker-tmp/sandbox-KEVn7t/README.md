# MyAgent

**一个能回答「关于这个仓库」的问题的 AI Agent。**

学习项目：用最小系统完整走一遍现代 Node/TypeScript 工程 —— 从纯领域逻辑
到测试策略、HTTP、持久化、可观测、前端、容器、部署。

- 路线和每个阶段的验收标准：[`Renkos1/ts-modern-train` 的 `docs/03`](https://github.com/Renkos1/ts-modern-train/blob/main/docs/03-agent-project-roadmap.md)
- 工程约定、命令、配置说明：同一个仓库的 `CLAUDE.md` 和 `docs/06`

## 命令

```bash
pnpm dev           # 运行开发入口（Node 直接跑 .ts，类型擦除）
pnpm check         # 类型检查（tsc = TypeScript 7 原生二进制）
pnpm lint          # ESLint，类型感知规则
pnpm format        # Prettier 写入
pnpm test          # Vitest
pnpm test:cov      # Vitest + v8 覆盖率
pnpm build         # 产物到 dist/
pnpm verify        # ★门禁★ check → lint → format:check → test → build
```

**`pnpm verify` 不绿不提交。**

## 当前状态

阶段 0：工程骨架。`src/banner.ts` 和对应测试是占位，阶段 1 建领域层时删掉。
