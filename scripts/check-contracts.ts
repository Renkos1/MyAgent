#!/usr/bin/env node
/**
 * 契约标记检查器 —— 把 JSDoc 里的「契约声明」和代码里的「契约引用」对上。
 *
 * ★这是一个「架构适应度函数」的最小样例★：
 * 自建一套标记规范，再写一个会失败的检查，让规矩自己检查自己。
 * 为什么不做成"生成一张图"，见 docs/engineering/19-markers-and-fitness-functions.md。
 *
 * ── 标记规范（全部内容就这四条）────────────────────────────────
 *   声明        JSDoc 内容行以圈号开头        *  ⑥ 处理顺序：先良构检查 → ……
 *   本模块引用  代码注释里裸写                 // 契约⑥：……
 *   跨模块引用  ★必须带文件名限定★             见 size.ts 契约②
 *   子条目      圈号后跟 -N                    // 契约③-1：……
 *
 * 用法   node scripts/check-contracts.ts [目录]      默认 src
 * 退出码 有 ⛔ 时为 1（可直接进 pnpm verify）；只有 ⚠ 时为 0
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MARKS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

/** 声明：JSDoc 内容行以圈号开头。★必须在 JSDoc 里★，避免把代码里的圈号当声明。 */
const DECL = new RegExp(`^\\s*\\*\\s*([${MARKS}])\\s`);
/** 引用：只认「契约」两个字后面紧跟的圈号。限定词单独往前找，见下。 */
const REF = new RegExp(`契约\\s*([${MARKS}])(?:-\\d+)?`, "g");
/**
 * 限定词 = 紧挨在「契约」前面的一段词。
 * ⚠ 必须排除开括号和标点：`骗它（size.ts 契约⑤` 里限定词是 size.ts 不是「骗它（size.ts」。
 *   第一版用 `(\S+?)\s+契约` 做正向匹配，就是在这里错的。
 */
const QUAL = /([^\s（(【「,，。：:、]+)$/;

interface Ref {
  readonly line: number;
  /** 跨模块引用的目标文件；本模块引用为 null */
  readonly target: string | null;
  readonly qualifier: string | null;
  readonly mark: string;
  readonly text: string;
}
interface Decl {
  readonly line: number;
  /** 同一个编号重复声明的行号 */
  readonly dup: number[];
}
interface Mod {
  readonly decls: Map<string, Decl>;
  readonly refs: Ref[];
}

/**
 * 递归收集 .ts，返回★相对 dir 的路径★（如 "domain/loop.ts"）。
 *
 * ⚠ 2026-09 修：原来这里不递归。把 `pnpm contracts src/domain` 改成 `src`
 *   之后，它只扫到 src/index.ts —— ★门禁悄悄从 6 个文件缩到 1 个，还打勾★。
 *   改门禁的作用域而不重新红一次，等于关掉了它。
 */
function listTs(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory())
      out.push(...listTs(full, `${prefix}${name}/`));
    else if (name.endsWith(".ts")) out.push(`${prefix}${name}`);
  }
  return out;
}

function parse(path: string): Mod {
  const decls = new Map<string, Decl>();
  const refs: Ref[] = [];
  let inDoc = false;

  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, i) => {
      const no = i + 1;

      if (/^\s*\/\*\*/.test(line)) inDoc = true;
      const d = inDoc ? DECL.exec(line) : null;
      const mark = d?.[1];
      if (mark !== undefined) {
        const seen = decls.get(mark);
        if (seen) seen.dup.push(no);
        else decls.set(mark, { line: no, dup: [] });
      }
      if (line.includes("*/")) inDoc = false;

      for (const m of line.matchAll(REF)) {
        const ref = m[1];
        if (ref === undefined) continue;
        const qualifier =
          QUAL.exec(line.slice(0, m.index).trimEnd())?.[1] ?? null;
        refs.push({
          line: no,
          target:
            qualifier !== null && qualifier.endsWith(".ts") ? qualifier : null,
          qualifier,
          mark: ref,
          text: line.trim(),
        });
      }
    });

  return { decls, refs };
}

const dir = process.argv[2] ?? "src";
const mods = new Map<string, Mod>(
  listTs(dir).map((f) => [f, parse(join(dir, f))]),
);
/** 跨模块引用写的是★裸文件名★（`见 size.ts 契约②`），这里把 basename 映回全路径。 */
const byBase = new Map<string, string>(
  [...mods.keys()].map((f) => [f.slice(f.lastIndexOf("/") + 1), f]),
);
const problems: string[] = [];

console.log(
  "模块            声明                代码引用   声明了但代码里没落地",
);
console.log("─".repeat(74));

for (const [file, { decls, refs }] of mods) {
  /** file 现在是 "domain/turn.ts"，而引用写的是裸 "turn.ts"。 */
  const base = file.slice(file.lastIndexOf("/") + 1);
  const own = refs.filter((r) => r.target === null || r.target === base);
  const used = new Set(own.map((r) => r.mark));
  const declared = [...decls.keys()].sort(
    (a, b) => MARKS.indexOf(a) - MARKS.indexOf(b),
  );
  const unlanded = declared.filter((m) => !used.has(m));

  console.log(
    file.padEnd(14),
    String(declared.length).padStart(2),
    (declared.join("") || "—").padEnd(12),
    String(own.length).padStart(4),
    "  ",
    unlanded.join("") || "—",
  );

  for (const r of own) {
    // ① 悬空：引用了本模块没声明的编号
    if (!decls.has(r.mark))
      problems.push(
        `⛔ 悬空引用      ${file}:${String(r.line)}  引用了契约${r.mark}，但本模块没声明它\n     ${r.text}`,
      );
    // ② 限定词不是文件名，机器对不上（如「1.3 契约⑤」）
    if (r.qualifier !== null && /^\d[\d.]*$/.test(r.qualifier))
      problems.push(
        `⚠ 限定词不可机读 ${file}:${String(r.line)}  「${r.qualifier} 契约${r.mark}」——限定词要写文件名\n     ${r.text}`,
      );
  }

  // ③ 跨模块引用的目标不存在
  for (const r of refs.filter((x) => x.target !== null && x.target !== base)) {
    const target = mods.get(byBase.get(r.target ?? "") ?? "");
    if (!target)
      problems.push(
        `⛔ 跨模块引用    ${file}:${String(r.line)}  指向不存在的模块 ${r.target ?? ""}`,
      );
    else if (!target.decls.has(r.mark))
      problems.push(
        `⛔ 跨模块引用    ${file}:${String(r.line)}  ${r.target ?? ""} 没有契约${r.mark}\n     ${r.text}`,
      );
  }

  // ④ 同一个编号声明两次
  for (const [mark, d] of decls)
    if (d.dup.length > 0)
      problems.push(
        `⛔ 编号重复      ${file}  契约${mark} 在 ${String(d.line)} 和 ${d.dup.join(",")} 各声明了一次`,
      );
}

console.log();
if (problems.length === 0) {
  console.log("✅ 没有问题");
} else {
  for (const p of problems) console.log(p);
  console.log(`\n共 ${String(problems.length)} 条`);
}

process.exit(problems.some((p) => p.startsWith("⛔")) ? 1 : 0);
