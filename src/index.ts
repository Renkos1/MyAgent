/**
 * 阶段 1 还没有真正的入口（阶段 6 接 HTTP 时才有）。
 * 现在是一个手动试路径校验的小工具：
 *
 *     pnpm dev ../etc/passwd
 */
import { resolveInsideRoot } from "./domain/path.ts";

/** 演示用的假 root。写死是为了和平台无关 —— 契约要求 root 是 POSIX 绝对路径。 */
const ROOT = "/repo";

const candidate = process.argv[2] ?? ".";
const result = resolveInsideRoot(ROOT, candidate);

console.log(
  result.ok
    ? `✓ 允许  ${JSON.stringify(candidate)} → ${result.value}`
    : `✗ 拒绝  ${JSON.stringify(candidate)} → ${result.error.kind}`,
);
