/**
 * 把磁盘上的题库 JSON 收窄成 {@link EvalCase}。纯的 —— 读文件的是调用方。
 *
 * @remarks
 * IMPORTANT: 题库是**外部输入**。它现在是我们自己写的、在 Git 里的文件，
 * 但类型系统对 `JSON.parse` 的结果一无所知 —— 少一个字段就是 `undefined`
 * 一路流进判分点，然后判出一个看起来很正常的分数。
 *
 * 手写而不是上 zod：MyAgent 现在没有这个依赖，而这一份只有一个形状。
 * 加依赖要走 ADR 的四段（候选/判据/选择/代价），为 50 行省不出这个成本。
 * 反悔信号：**第二个**需要校验的外部格式出现时（阶段 4 的适配器响应），
 * 那时两份手写校验的重复就值一个依赖了。
 *
 * @see docs/decisions/0013-eval-case-format.md
 */
import type { ToolName } from "../app/ports.ts";
import type { Result } from "../domain/result.ts";
import { err, ok } from "../domain/result.ts";
import type { Check, EvalCase } from "./case.ts";

/** 哪里错了、错在什么。IMPORTANT: 一次报全部，不是第一条就返回。 */
export type ParseError = { readonly at: string; readonly why: string };

const TOOL_NAMES = ["list_files", "read_file", "search"] as const;

/**
 * 双向包含。{@link ToolName} 加了一格而这里没加，这个类型就变成 never。
 *
 * @remarks
 * 和 `ports.ts` 的 `KindsMatch` 同一个手法 —— 手写校验的代价就是这种
 * 「两处要一起改」，所以把它交给编译器盯着，不交给记性。
 */
type ToolNamesMatch = [ToolName] extends [(typeof TOOL_NAMES)[number]]
  ? [(typeof TOOL_NAMES)[number]] extends [ToolName]
    ? true
    : never
  : never;
const _toolNames: ToolNamesMatch = true;
void _toolNames;

/**
 * 这个文件里有四个变异体永远杀不掉，四个是同一回事。
 *
 * NOTE: 它们都是**类型层的守卫**，不是行为层的：
 *   `typeof tool !== "string"`   后面跟着 isToolName，而 includes 对任何值都返回
 *   `typeof max !== "number"`    后面跟着 Number.isInteger，同样是全函数
 *   `c !== undefined`            checks 的元素类型要求它，且下一行的 before 兜着
 *   `_toolNames = true`          编译期门禁，运行时是死代码（同 ports.ts 的 KindsMatch）
 *
 * 去掉任何一个，运行时行为不变，tsc 立刻红。所以它们既不是漏测也不是冗余 ——
 * IMPORTANT: 变异测试量的是运行时行为，量不到类型层。这一类存活是预期内的，
 * 报告里看见它们不要再去补测试（补不出来）。
 */

/** 是不是普通对象（不是 null、不是数组）。 */
function isRecord(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 校验一条判分点，把错误推进 out。 */
function readCheck(
  v: unknown,
  at: string,
  out: ParseError[],
): Check | undefined {
  if (!isRecord(v)) {
    out.push({ at, why: "判分点不是对象" });
    return undefined;
  }
  const { kind } = v;
  switch (kind) {
    case "used-tool":
    case "no-tool": {
      const { tool } = v;
      if (typeof tool !== "string" || !isToolName(tool)) {
        out.push({ at: `${at}.tool`, why: `不是工具名：${String(tool)}` });
        return undefined;
      }
      return kind === "used-tool"
        ? { kind: "used-tool", tool }
        : { kind: "no-tool", tool };
    }
    case "within-turns": {
      const { max } = v;
      // NOTE: 三个条件缺一不可 —— 1.5 轮和 -1 轮都不是「轮」。
      if (typeof max !== "number" || !Number.isInteger(max) || max < 1) {
        out.push({ at: `${at}.max`, why: `不是正整数：${String(max)}` });
        return undefined;
      }
      return { kind: "within-turns", max };
    }
    case "answered":
      return { kind: "answered" };
    case "mentions": {
      const { text } = v;
      if (typeof text !== "string" || text.length === 0) {
        out.push({ at: `${at}.text`, why: "要一个非空字符串" });
        return undefined;
      }
      return { kind: "mentions", text };
    }
    default:
      out.push({ at: `${at}.kind`, why: `没有这种判分点：${String(kind)}` });
      return undefined;
  }
}

/** 工具名的运行时收窄。 */
function isToolName(s: string): s is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(s);
}

/** 校验一道题。 */
function readCase(
  v: unknown,
  at: string,
  out: ParseError[],
): EvalCase | undefined {
  if (!isRecord(v)) {
    out.push({ at, why: "题目不是对象" });
    return undefined;
  }
  const { id, question, expect, tags } = v;
  const before = out.length;
  if (typeof id !== "string" || id.length === 0)
    out.push({ at: `${at}.id`, why: "要一个非空字符串" });
  if (typeof question !== "string" || question.length === 0)
    out.push({ at: `${at}.question`, why: "要一个非空字符串" });
  if (!Array.isArray(expect) || expect.length === 0)
    out.push({ at: `${at}.expect`, why: "要一个非空数组" });
  if (!Array.isArray(tags))
    out.push({ at: `${at}.tags`, why: "要一个数组（可以为空）" });
  else if (!tags.every((t) => typeof t === "string"))
    out.push({ at: `${at}.tags`, why: "标签只能是字符串" });

  const checks: Check[] = [];
  if (Array.isArray(expect)) {
    for (const [i, e] of expect.entries()) {
      const c = readCheck(e, `${at}.expect[${String(i)}]`, out);
      if (c !== undefined) checks.push(c);
    }
  }
  if (out.length !== before) return undefined;
  // 到这里四个字段都已经查过了，收窄靠上面的 push 分支穷尽
  return {
    id: id as string,
    question: question as string,
    expect: checks,
    tags: tags as readonly string[],
  };
}

/**
 * 把 `JSON.parse` 的结果收窄成题库。
 *
 * @remarks
 * IMPORTANT: id 重复直接拒绝，不是「后面的覆盖前面的」。
 * 重复的 id 会让成绩单里的失败明细指向两道题，事后没法定位 ——
 * 和 ADR 0012 §③ 拒绝同名录音带是同一条判据。
 *
 * @param raw - `JSON.parse` 出来的任意值
 * @returns 全部题目，或者全部错误（不是第一条）
 */
export function parseCases(
  raw: unknown,
): Result<readonly EvalCase[], readonly ParseError[]> {
  if (!Array.isArray(raw))
    return err([{ at: "根", why: "题库要是一个数组" }] as const);

  const errors: ParseError[] = [];
  const cases: EvalCase[] = [];
  for (const [i, v] of raw.entries()) {
    const c = readCase(v, `[${String(i)}]`, errors);
    if (c !== undefined) cases.push(c);
  }

  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) errors.push({ at: c.id, why: "id 重复" });
    seen.add(c.id);
  }

  return errors.length > 0 ? err(errors) : ok(cases);
}
