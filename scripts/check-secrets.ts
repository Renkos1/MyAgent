#!/usr/bin/env node
/**
 * 秘密扫描门禁 —— 阶段 5 的 D5，选的是「本地和 CI 都跑，装不上要红不要 skip」。
 *
 * ── 为什么不能 skip ──────────────────────────────────────────
 *   一道装不上就自动消失的门，比没有这道门更糟：它让人以为这件事已经有人管了。
 *   IMPORTANT: 所以「找不到 gitleaks」和「扫出了秘密」都是非 0 退出，
 *   区别只在打印出来的话不一样。
 *
 * ── 扫什么，为什么是这三样 ───────────────────────────────────
 *   ① .env 有没有被 git 跟踪
 *      最贵的那次事故的精确形状。gitleaks 也能扫出来，但这条判据是确定的：
 *      .env 出现在 git ls-files 里，本身就是错的，跟里面写了什么无关。
 *   ② gitleaks git .           整个历史
 *      IMPORTANT: 已经推上去的 key 就是泄露了 —— 删 commit 没用，必须去
 *      provider 后台吊销。所以要扫的是历史，不只是当前这一版。
 *   ③ gitleaks git . --staged  暂存区
 *      verify 跑在 commit 之前，这一条是唯一能赶在事故发生前拦住的。
 *
 *   TRAP: 不用 `gitleaks dir .`。它连 .gitignore 的文件一起扫，本机的 .env
 *   会被报成 leak —— 而 .env 里有 key 正是设计。2026-09 实测：
 *   `dir .` 报 1 条，就是 .env:2。误报会让人去关门禁，不会让人去修问题。
 *   走 git 作用域天然就尊重 .gitignore。
 *
 *   已知缺口（写下来，不假装没有）：改了但没 stage 的内容不在扫描范围里。
 *   commit 不了没 stage 的东西，所以这个窗口在下一次 verify 时关上。
 *
 * ── IMPORTANT: 这道门能抓到什么，和你以为的不一样 ────────────
 *   2026-09 实测（gitleaks v8，默认规则集）。第一次见红失败，查出来的原因是
 *   **默认规则主要靠标识符的名字触发，不是靠值长得像不像密钥**：
 *
 *   ```text
 *   const apiKey = "<48 位随机>"       抓到   generic-api-key
 *   const token  = "<48 位随机>"       抓到   generic-api-key
 *   const banana = "<48 位随机>"       漏掉   同一个值，只换了变量名
 *   token 那一格填 ghp_ 开头的值        抓到   github-pat（值有前缀特征）
 *   aws_access_key_id 填官方示例值      漏掉   AKIA...EXAMPLE 在白名单里
 *   ```
 *
 *   TRAP: 上面这张表原来直接写了示例值，结果**被这个脚本自己抓了** ——
 *   `token = <高熵串>` 正是 generic-api-key 的触发形状，哪怕值是截断的。
 *   同 ts-modern-train engineering/19 坑 ⑦：IMPORTANT: 写检查器先问它会不会扫到自己。
 *   这已经是本项目第三次踩它（check-notation 的字面量、门禁三的 yaml 注释）。
 *
 *   两条结论：
 *   ① 起名叫 `cfg` / `banana` 的秘密，这道门一个都抓不到。
 *      TRAP: 所以它是**兜底**，不是「有它就安全了」。真正的防线是
 *      `.gitignore` + `Secret<T>` + 代码里根本不出现 key 这三样。
 *   ② 写见红测试时，假 key 要用**真随机值 + 像样的变量名**。
 *      第一次见红用的是 `apiKey: "sk-ant-api03-FAKE9x..."`，
 *      门禁一声不吭 —— 差一点就把一道永远不会响的门接进 verify。
 *
 * ── 找不到二进制怎么办 ───────────────────────────────────────
 *   先看 PATH，再看 `go env GOPATH`/bin（go install 装的默认落在那儿，
 *   而它不一定在 PATH 里 —— 本机实测就是这样）。
 *
 * 用法   node scripts/check-secrets.ts [仓库根目录]     默认当前目录
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? ".";
const LINE = "─".repeat(70);

/** go install 装出来的位置。IMPORTANT: 它不一定在 PATH 里。 */
function goBin(): string | undefined {
  try {
    const gopath = execFileSync("go", ["env", "GOPATH"], {
      encoding: "utf8",
    }).trim();
    if (gopath === "") return undefined;
    for (const name of ["gitleaks.exe", "gitleaks"]) {
      const full = join(gopath, "bin", name);
      if (existsSync(full)) return full;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** 找 gitleaks。找不到返回 undefined —— 调用方必须让它红，不许当没这回事。 */
function findGitleaks(): string | undefined {
  const onPath = spawnSync("gitleaks", ["version"], { encoding: "utf8" });
  if (onPath.status === 0) return "gitleaks";
  return goBin();
}

const bin = findGitleaks();
if (bin === undefined) {
  console.error(LINE);
  console.error("找不到 gitleaks —— 这道门禁是红的，不是跳过的。");
  console.error("");
  console.error("装它（任选一种）：");
  console.error("  go install github.com/zricethezav/gitleaks/v8@latest");
  console.error("  winget install gitleaks");
  console.error("");
  console.error("go install 装完如果还是找不到，把这个目录加进 PATH：");
  console.error("  go env GOPATH  的 bin 子目录");
  console.error(LINE);
  process.exit(1);
}

// NOTE: 重新绑一个 const。上面的 process.exit(1) 收窄不到下面 scan 那个闭包里
//       —— tsc 不知道 exit 之后不会往下走（它的返回类型是 never，但收窄只在
//       同一个作用域的控制流上成立）。
const gitleaks: string = bin;

let failed = false;

// ── ① .env 不许被跟踪 ──────────────────────────────────────────────
// NOTE: --error-unmatch 在文件没被跟踪时非 0 退出，所以「非 0」才是我们要的。
const tracked = spawnSync("git", ["ls-files", "--error-unmatch", ".env"], {
  cwd: root,
  encoding: "utf8",
});
if (tracked.status === 0) {
  console.error("[tracked-dotenv] .env 被 git 跟踪了。");
  console.error(
    "    这不是「里面写了什么」的问题 —— .env 出现在版本库里本身就是错的。",
  );
  console.error("    git rm --cached .env  然后确认 .gitignore 里有它。");
  failed = true;
} else {
  console.log("✅ .env 没有被 git 跟踪");
}

/** 跑一次 gitleaks，红了打印 redact 过的明细。 */
function scan(label: string, args: readonly string[]): void {
  // SAFETY: --redact 不是可选的。没有它，门禁自己会把秘密打进 CI 日志 ——
  //         那是把一次「差点泄露」变成一次「真的泄露」。
  const r = spawnSync(gitleaks, [...args, "--no-banner", "--redact", "-v"], {
    cwd: root,
    encoding: "utf8",
  });
  if (r.status === 0) {
    console.log(`✅ ${label} 干净`);
    return;
  }
  console.error(`❌ ${label} 扫出东西了：`);
  console.error(r.stdout.trim());
  console.error(r.stderr.trim());
  failed = true;
}

// ── ② 历史 ────────────────────────────────────────────────────────
scan("git 历史", ["git", "."]);

// ── ③ 暂存区 ──────────────────────────────────────────────────────
scan("暂存区", ["git", ".", "--staged"]);

console.log(LINE);
if (failed) {
  console.error("有问题。");
  console.error("");
  console.error("SAFETY: 如果扫出来的是一个真 key，删 commit 没有用 ——");
  console.error(
    "        它已经在你的 reflog、别人的 clone、和 GitHub 的缓存里。",
  );
  console.error("        第一件事是去 provider 后台吊销它，然后再谈清理历史。");
  process.exit(1);
}
console.log("没有问题");
