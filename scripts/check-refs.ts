#!/usr/bin/env node
/**
 * ADR 引用检查器 —— 代码注释里提到的 ADR 必须真的存在。
 *
 * ── 为什么需要 ────────────────────────────────────────────────
 *   这个项目的注释大量引用 ADR（`@see docs/decisions/0008-path-resolution.md`）。
 *   文件改名或编号变了之后，注释里的路径不会跟着变，而且**没有任何东西会发现**
 *   —— tsc 不看字符串，ESLint 不看字符串，测试更不会。
 *
 *   IMPORTANT: 这是阶段 5 当场撞到的，不是假想。`src/infra/env.ts` 写的编号
 *   和 slug 与 ADR 定稿时的文件名对不上（草稿叫 env-config，定稿叫 env-and-secrets）。
 *   verify 九步全绿、CI 全绿、PR 合了，才在事后体检时发现。
 *
 *   ts-modern-train 那边有一道 `pnpm links` 会抓这类问题，MyAgent 一直没有
 *   —— 两个仓库各缺对方一道门。这个脚本补的是这一半。
 *
 * ── 只管 ADR，不管别的 docs 路径 ──────────────────────────────
 *   TRAP: 第一版的规则是「任何 `docs/**.md` 都要存在」，跑出来 32 条，
 *   其中 31 条是误报。三类，每一类都说明规则错在哪：
 *
 *   ```text
 *   docs/a.md / docs/nope.md    路径校验测试的假数据，本来就不该存在
 *   docs/MAP.md / experience.md 指向另一个仓库（ts-modern-train）的文档
 *   脚本自己注释里那句例子      第四次「尺子扫到尺子」
 *   ```
 *
 *   IMPORTANT: 误报会让人去关门禁，不会让人去修问题（同 check-secrets 里
 *   不用 `gitleaks dir .` 的判据）。所以收窄到唯一无歧义的那一类：
 *   **`docs/decisions/NNNN-slug.md`** —— ADR 是本仓库自己的，
 *   不会是测试假数据，也不会指向别的仓库。
 *
 *   已知缺口：跨仓引用（指向 ts-modern-train 的文档）核对不了 ——
 *   要核对就得知道那个仓库在哪，而那是环境假设。留着不管。
 *   不管  http(s) 链接：要联网，而且外链失效不该让 verify 红
 *
 * 用法   node scripts/check-refs.ts [仓库根目录]     默认当前目录
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? ".";
const DIRS = ["src", "test", "scripts"];
const LINE = "─".repeat(70);

/** ADR 路径。NOTE: 编号必须是四位 —— 松一点就会把跨仓的普通文档吃进来。 */
const REF = /docs\/decisions\/[0-9]{4}-[a-z0-9-]+\.md/g;

/** 递归收 .ts。目录不存在就当空的。 */
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

const files = DIRS.flatMap((d) => walk(join(root, d)));
const bad: string[] = [];
let checked = 0;

for (const file of files) {
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      for (const m of line.matchAll(REF)) {
        checked += 1;
        if (!existsSync(join(root, m[0]))) {
          bad.push(`${file.replaceAll("\\", "/")}:${String(i + 1)}  ${m[0]}`);
        }
      }
    });
}

console.log(
  `扫描 ${String(files.length)} 个 .ts，${String(checked)} 条文档引用`,
);
console.log(LINE);
if (bad.length > 0) {
  for (const b of bad) console.error(`断链  ${b}`);
  console.error(`\n共 ${String(bad.length)} 条`);
  process.exit(1);
}
console.log("没有问题");
