#!/usr/bin/env node
/**
 * 记号检查器 —— 让「代码里不用自造的强调符号」变成一道会红的门禁。
 *
 * 背景见 ts-modern-train 的 docs/engineering/26-comment-conventions.md §②：
 * 强调和警示用约定标签（NOTE / IMPORTANT / SAFETY / TRAP / TODO），
 * 因为它们可 grep、可门禁、别人认识、不破坏等宽对齐。
 *
 * ── 为什么需要门禁 ────────────────────────────────────────────
 *   2026-09 实测：规范写完当天，src/ 就被重新塞进 22 个强调符号。
 *   IMPORTANT: 规范只写在文档里时，唯一的执行者是记性 —— 记性会输。
 *
 * ── 管什么，不管什么 ──────────────────────────────────────────
 *   管    src/ 和 test/ 的全部 .ts，加上 scripts/check-*.ts
 *         判据是「这个文件会不会被反复读和改」——
 *         门禁脚本会（每次红了都有人读它的头注释和输出）
 *   不管  scripts/ 里的一次性测量脚本（bench-* / co-change 之类）：
 *         跑一次、数字进文档，之后没人再读。为它们改 99 处是纯 churn
 *   不管  CLI 输出里的符号（禁止号、对勾）：那是给终端看的词汇，不是注释
 *   不管  docs/ 下的 markdown：读者是人不是 grep，渲染出来需要视觉重量
 *
 * 用法   node scripts/check-notation.ts [仓库根目录]     默认当前目录
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 禁用的强调符号 → 该改成什么。
 *
 * IMPORTANT: 写成 \u 转义，不写字面量 —— 否则这个文件会告自己。
 *            实测：第一版写了字面量，跑出来 4 条告的是它本身。
 */
const BANNED: ReadonlyArray<readonly [string, string]> = [
  ["\u2605", "实心星：改成 IMPORTANT: / SAFETY:，或直接去掉"],
  ["\u2606", "空心星：同上"],
  ["\u26A0", "警告号：改成 IMPORTANT: 或 TRAP:"],
];

const DIRS = ["src", "test", "scripts"];

/** scripts/ 只看门禁脚本。理由见文件头。 */
function inScope(file: string): boolean {
  const norm = file.replaceAll("\\", "/");
  if (!norm.includes("/scripts/") && !norm.startsWith("scripts/")) return true;
  return /(^|\/)check-[^/]*\.ts$/.test(norm);
}

const root = process.argv[2] ?? ".";

/** 递归收集一个目录下所有 .ts。目录不存在就当空的。 */
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

const files = DIRS.flatMap((d) => walk(join(root, d))).filter(inScope);
const problems: string[] = [];

for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  for (const [i, line] of lines.entries()) {
    for (const [sym, fix] of BANNED) {
      if (!line.includes(sym)) continue;
      problems.push(
        `禁用记号  ${file}:${String(i + 1)}  ${fix}\n     ${line.trim().slice(0, 76)}`,
      );
      break;
    }
  }
}

console.log(`扫描 ${String(files.length)} 个 .ts（src / test / scripts 的门禁脚本）`);
console.log("─".repeat(70));

if (problems.length === 0) {
  console.log("没有问题");
} else {
  for (const p of problems) console.log(p);
  console.log(`\n共 ${String(problems.length)} 条`);
}
process.exit(problems.length > 0 ? 1 : 0);
