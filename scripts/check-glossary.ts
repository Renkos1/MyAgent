#!/usr/bin/env node
/**
 * 词表检查器 —— 让 docs/glossary.md 变成一道会红的门禁。
 *
 * ★L6 语义层唯一能自动化的部分★：tsc / ESLint / 测试 / 变异检查
 * 一个都发现不了「一个概念两个名字」，因为那不是行为问题。
 * 见 docs/engineering/20-contract-levels.md。
 *
 * ── 检查两件事 ────────────────────────────────────────────────
 *   ⛔ 复活   「已作废的拼法」表里的词，又在 src/ 或 test/ 里出现了
 *   ⛔ 过期   「核心词」表点名的标识符，代码里已经找不到 —— ★词表在撒谎★
 *
 * ⚠ 只检查这两张★形状固定★的表。「允许的同义词」那一节是给人读的散文，
 *   机器不碰 —— 混进来只会制造误报，然后整个检查被关掉。
 *
 * 用法   node scripts/check-glossary.ts [仓库根目录]      默认当前目录
 *        读 <根>/docs/glossary.md，扫 <根>/src 和 <根>/test
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? ".";
const glossaryPath = join(root, "docs", "glossary.md");

if (!existsSync(glossaryPath)) {
  console.error(`⛔ 找不到词表：${glossaryPath}`);
  process.exit(1);
}

/** 取一个 markdown 表格的某一列。表格 = 从标题往下第一个 | 开头的连续块。 */
function column(md: string, heading: string, colName: string): string[] {
  const at = md.indexOf(heading);
  if (at === -1) throw new Error(`词表里找不到小节：${heading}`);
  const rows = md
    .slice(at)
    .split("\n")
    .slice(1)
    .filter(
      (l, i, all) =>
        l.startsWith("|") || all.slice(0, i).some((x) => x.startsWith("|")),
    )
    .filter((l) => l.startsWith("|"));
  const cells = (line: string): string[] =>
    line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
  const header = rows[0];
  if (header === undefined) throw new Error(`小节 ${heading} 下面没有表格`);
  const idx = cells(header).findIndex((c) => c.includes(colName));
  if (idx === -1) throw new Error(`表格里找不到列：${colName}`);
  return rows
    .slice(2) // 跳过表头和分隔行
    .map((r) => cells(r)[idx])
    .filter((c): c is string => c !== undefined);
}

/** 从单元格里抠出反引号包着的东西。 */
const ticked = (cell: string): string[] =>
  [...cell.matchAll(/`([^`]+)`/g)]
    .map((m) => m[1] ?? "")
    .filter((t) => t !== "");

const md = readFileSync(glossaryPath, "utf8");
/** 作废的拼法：原样匹配，包括带引号的 kind 字面量 */
const retired = column(md, "已作废的拼法", "作废").flatMap(ticked);
/** 词表点名的标识符：`LoopLimits.maxToolRuns` → LoopLimits，`measure(t,…)` → measure */
const named = [
  ...new Set(
    column(md, "核心词", "代码里")
      .flatMap(ticked)
      .map((t) => t.split(/[.(]/)[0] ?? "")
      .filter((t) => /^[A-Za-z_$][\w$]*$/.test(t)),
  ),
];

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return name.endsWith(".ts") ? [full] : [];
  });
}
const files = [...walk(join(root, "src")), ...walk(join(root, "test"))];
const sources = files.map((f) => ({
  file: f,
  lines: readFileSync(f, "utf8").split("\n"),
}));

/** 标识符按词边界匹配；带引号或连字符的按原样子串匹配。 */
function hits(term: string): { file: string; line: number; text: string }[] {
  const pure = /^[A-Za-z_$][\w$]*$/.test(term);
  const re = pure ? new RegExp(`\\b${term}\\b`) : null;
  const out: { file: string; line: number; text: string }[] = [];
  for (const { file, lines } of sources)
    lines.forEach((text, i) => {
      if (re ? re.test(text) : text.includes(term))
        out.push({ file, line: i + 1, text: text.trim() });
    });
  return out;
}

const problems: string[] = [];

console.log(
  `词表 ${glossaryPath}：作废 ${String(retired.length)} 条，点名标识符 ${String(named.length)} 个`,
);
console.log(`扫描 ${String(files.length)} 个 .ts 文件`);
console.log("─".repeat(70));

for (const term of retired) {
  const found = hits(term);
  if (found.length === 0) continue;
  for (const f of found)
    problems.push(
      `⛔ 作废的拼法复活  ${f.file}:${String(f.line)}  ${term}\n     ${f.text}`,
    );
}

for (const id of named) {
  if (hits(id).length === 0)
    problems.push(
      `⛔ 词表过期  代码里已经没有 ${id} 了 —— ★词表在撒谎，改词表或改代码★`,
    );
}

if (problems.length === 0) {
  console.log("✅ 没有问题");
} else {
  for (const p of problems) console.log(p);
  console.log(`\n共 ${String(problems.length)} 条`);
}
process.exit(problems.length > 0 ? 1 : 0);
