#!/usr/bin/env node
/**
 * pnpm eval —— 跑一遍题库，打印分数，把成绩单写进 eval/results/。
 *
 * IMPORTANT: 退出码恒为 0，就算题全挂（ADR 0013 §④）。
 * 这不是没写完 —— 阈值 k 的输入 p0 现在是未知数（还没接真模型），
 * 写任何一个 k 都是在「天天误报」和「退化了也不知道」之间瞎选一个。
 * 一个永远绿的假门禁比没有门禁更糟，因为它让人以为这件事已经有人管了。
 * 解除条件：阶段 4 接上模型的第一件事是量 p0。
 *
 * IMPORTANT: 这一层不进 pnpm verify（ADR 0013 §⑤）——
 * 概率门禁混进确定门禁，整条 CI 的语义会从「绿 = 对」塌成「绿 = 运气不错」。
 *
 * 这个文件是 eval 的组合根，地位同 src/index.ts：
 * 下面那个假被测对象在阶段 4 会被整个换掉，所以它不进 src/，也不算覆盖率。
 *
 * 用法   node scripts/eval.ts [题库路径] [成绩单目录]
 *        默认 eval/cases.json 和 eval/results
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCases } from "../src/eval/parse.ts";
import { runEval } from "../src/eval/run.ts";
import type { Subject } from "../src/eval/run.ts";
import { toTranscript } from "../src/eval/transcript.ts";
import { collect, run } from "../src/app/runTurn.ts";
import { createRunConfig } from "../src/app/config.ts";
import type { RunConfig } from "../src/app/config.ts";
import { FakeLlm } from "../src/infra/fake/llm.ts";
import type { Scripted } from "../src/infra/fake/llm.ts";
import { FakeTools } from "../src/infra/fake/tools.ts";
import type { ToolOutcome } from "../src/app/ports.ts";
import { NO_META } from "../src/app/ports.ts";

const casesPath = process.argv[2] ?? join("eval", "cases.json");
const outDir = process.argv[3] ?? join("eval", "results");

const raw: unknown = JSON.parse(readFileSync(casesPath, "utf8"));
const parsed = parseCases(raw);
if (!parsed.ok) {
  // NOTE: 题库读不进来是我们的文件写坏了，不是被测对象的分数问题 ——
  //       这一条才该非 0 退出。「恒 0」说的是分数，不是一切。
  console.error(`题库不合法：${casesPath}`);
  for (const e of parsed.error) console.error(`  ${e.at}  ${e.why}`);
  process.exit(1);
}

const cfg = createRunConfig({
  limits: {
    maxModelCalls: 4,
    maxToolRuns: 4,
    maxInputBytesPerItem: 4096,
    maxInputBytesTotal: 65536,
  },
  maxConcurrentTools: 2,
  maxRetries: 0,
  retryBaseMs: 1,
  userInputMode: "reject",
  toolResultMode: "truncate",
} satisfies RunConfig);
if (!cfg.ok) throw new Error(`配置非法：${cfg.error.kind}`);
const config = cfg.value;

/** 假模型知道怎么答的几个问题。查不到的一律 empty —— 装不懂就是装不懂。 */
const SCRIPTS: Readonly<
  Record<
    string,
    {
      readonly script: readonly Scripted[];
      readonly tools: Readonly<Record<string, ToolOutcome>>;
    }
  >
> = {
  "docs 下有什么？": {
    script: [
      {
        ok: true,
        value: {
          kind: "tool-requested",
          meta: NO_META,
          calls: [{ name: "list_files", id: "a", dir: "docs" }],
        },
      },
      {
        ok: true,
        value: {
          kind: "completed",
          meta: NO_META,
          text: "docs 下有 README.md 和 MAP.md。",
        },
      },
    ],
    tools: { a: { kind: "ok", content: "README.md\nMAP.md" } },
  },
  "docs/README.md 讲了什么？": {
    script: [
      {
        ok: true,
        value: {
          kind: "tool-requested",
          meta: NO_META,
          calls: [{ name: "read_file", id: "a", path: "docs/README.md" }],
        },
      },
      {
        ok: true,
        value: {
          kind: "completed",
          meta: NO_META,
          text: "它是按场景的文档入口。",
        },
      },
    ],
    tools: { a: { kind: "ok", content: "# 文档入口" } },
  },
  你好: {
    script: [
      {
        ok: true,
        value: {
          kind: "completed",
          meta: NO_META,
          text: "你好，问我这个仓库的事。",
        },
      },
    ],
    tools: {},
  },
  "docs 下有什么，README 里又写了什么？": {
    script: [
      {
        ok: true,
        value: {
          kind: "tool-requested",
          meta: NO_META,
          calls: [
            { name: "list_files", id: "a", dir: "docs" },
            { name: "read_file", id: "b", path: "docs/README.md" },
          ],
        },
      },
      {
        ok: true,
        value: {
          kind: "completed",
          meta: NO_META,
          text: "两个文件，README 是入口。",
        },
      },
    ],
    tools: {
      a: { kind: "ok", content: "README.md\nMAP.md" },
      b: { kind: "ok", content: "# 文档入口" },
    },
  },
};

/** 阶段 3 的被测对象：一个查表的假模型。阶段 4 换成真适配器时只改这一个函数。 */
const subject: Subject = async (question) => {
  const entry = SCRIPTS[question];
  const llm = new FakeLlm(
    entry?.script ?? [{ ok: true, value: { kind: "empty", meta: NO_META } }],
  );
  const tools = new FakeTools(entry?.tools ?? {});
  const { events, result } = await collect(
    run(
      { llm, tools, sleep: () => Promise.resolve() },
      config,
      "你是仓库助手。",
      question,
    ),
  );
  return toTranscript(events, result);
};

const report = await runEval(
  parsed.value,
  subject,
  "fake-scripted",
  () => new Date(),
);

// TRAP: ISO 时间戳里的冒号在 Windows 上是非法文件名字符。同 ADR 0012 的录音带文件名。
const stamp = report.at.replaceAll(":", "-").replace(/\.\d+Z$/, "Z");
mkdirSync(outDir, { recursive: true });

/**
 * 找一个还没被占的文件名。
 *
 * IMPORTANT: 文件名精确到秒，同一秒跑两次就会撞名 —— 而 writeFileSync 覆盖时
 * 一声不吭。成绩单的全部价值是**趋势**（ADR 0013 §③），覆盖 = 悄悄删掉一个数据点。
 * 和 ADR 0012 §③ 拒绝同名录音带同一条判据：写盘前先看有没有人在那儿。
 *
 * NOTE: 这里不像录音带那样直接抛 —— 跑一次 eval 是要花钱的，
 * 为了一个文件名把已经拿到的分数丢掉不划算。所以是换名字，并且**说出来**。
 *
 * @param base - 不带序号的名字
 * @returns 确实没被占的完整路径
 */
function freeName(base: string): string {
  const first = join(outDir, `${base}.json`);
  if (!existsSync(first)) return first;
  for (let n = 2; ; n++) {
    const next = join(outDir, `${base}-${String(n)}.json`);
    if (!existsSync(next)) {
      console.log(
        `注意    ${base}.json 已存在，这一份写成 ${base}-${String(n)}.json`,
      );
      return next;
    }
  }
}

const file = freeName(stamp);
writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`题库    ${casesPath}（${String(report.total)} 道）`);
console.log(`被测    ${report.subject}`);
console.log(`通过    ${String(report.passed)}/${String(report.total)}`);
for (const f of report.failures) {
  console.log(`  挂  ${f.id}`);
  for (const why of f.failed) console.log(`        ${why}`);
}
console.log(`成绩单  ${file}`);
console.log("退出码  0（恒定，见 ADR 0013 §④）");
