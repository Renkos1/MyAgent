import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 阶段 5 的三道「适应度函数」——  IMPORTANT: 它们测的是**源码和配置的形状**，
 * 不是行为。
 *
 * 为什么需要这一类：阶段 5 加了三道防线（Secret / gitleaks / CI 扫描），
 * 三道里有两道处在**没人验证验证者**的位置 ——
 * 门禁脚本和 CI 配置都不在 548 个行为用例的射程里。
 * 实测代价：埋进去的 4 个 bug，有 3 个落在这个盲区，verify 一声不吭。
 *
 * TRAP: 这类测试的鉴别力有上限。它们能摁住「这一行被改掉了」，
 * 摁不住「换个写法绕过去」（比如不叫 console.log 改用 process.stdout.write）。
 * 所以它们是**兜底**，和 gitleaks 一样 —— 不要因为它们绿了就以为这件事完了。
 */

const read = (p: string): string => readFileSync(p, "utf8");

/** 递归收 .ts。 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".ts")) out.push(full.replaceAll("\\", "/"));
  }
  return out;
}

describe("门禁一 · 真值不许流进打印语句", () => {
  /**
   * NOTE: 判据不是「.expose() 有几处」。阶段 5 收工时数出来是 7 处，
   * 其中 6 处是脚本在组合根把真值交给 SDK —— 那是**边界**，不是往上游漏。
   * 有意义的判据是**真值有没有流进输出**。
   */
  const files = [...walk("src"), ...walk("scripts")];

  it("没有任何一行同时出现 .expose() 和 console.", () => {
    const bad: string[] = [];
    for (const f of files) {
      read(f)
        .split("\n")
        .forEach((line, i) => {
          if (line.trimStart().startsWith("*")) return; // TSDoc 里的例子不算
          if (line.trimStart().startsWith("//")) return;
          if (line.includes(".expose()") && line.includes("console."))
            bad.push(`${f}:${String(i + 1)}  ${line.trim()}`);
        });
    }
    expect(bad).toEqual([]);
  });

  it("src/ 里 .expose() 只许出现在组合根", () => {
    const inSrc = walk("src").filter((f) =>
      read(f)
        .split("\n")
        .some(
          (l) =>
            l.includes(".expose()") &&
            !l.trimStart().startsWith("*") &&
            !l.trimStart().startsWith("//"),
        ),
    );
    // domain/secret.ts 里只有 TSDoc 提到它，上面的过滤已经排掉
    expect(inSrc).toEqual(["src/index.ts"]);
  });
});

describe("门禁二 · gitleaks 的每一次调用都带 --redact", () => {
  const src = read("scripts/check-secrets.ts");

  it("scan 里没有「要不要 redact」这种开关", () => {
    // SAFETY: --redact 一旦可选，红的那一次会把秘密打进 CI 日志 ——
    //         门禁自己把「差点泄露」变成「真的泄露」。
    expect(src).not.toMatch(/redact\s*[=:]\s*(true|false)/);
    expect(src).not.toMatch(/redact\s*\?/);
  });

  it("每一处 spawnSync(gitleaks 都带 --redact", () => {
    const calls = [...src.matchAll(/spawnSync\(\s*gitleaks[\s\S]{0,200}?\)/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c[0]).toContain('"--redact"');
  });
});

describe("门禁三 · CI 拿得到完整历史", () => {
  const ci = read(".github/workflows/ci.yml");
  /**
   * NOTE: 先滤掉 yaml 注释再断言。
   * TRAP: 第一版直接对全文断言「不许出现 fetch-depth: 非 0」，结果被自己那行
   * 解释性注释（"默认是 fetch-depth: 1"）判红 —— 尺子量到了尺子上的刻度。
   * 和 check-notation 当初写 \u 转义、check-contracts 第一版误报是同一类错。
   */
  const effective = ci
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");

  it("fetch-depth 必须是 0", () => {
    // IMPORTANT: 默认 1。任何非 0 的值都会让 `gitleaks git .` 在 CI 上
    //            只扫最近 N 个 commit 然后报绿 —— 本地复现不出来，
    //            因为本地有完整历史。这是 CI 侧独有的一种假绿。
    expect(effective).toMatch(/fetch-depth:\s*0\b/);
    expect(effective).not.toMatch(/fetch-depth:\s*[1-9]/);
  });

  it("CI 真的装了 gitleaks，否则 verify 那一步会直接红", () => {
    expect(ci).toContain("gitleaks");
    expect(ci).toContain("GITHUB_PATH");
  });
});
