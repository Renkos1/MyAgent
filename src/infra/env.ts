/**
 * 环境变量 -> 类型化的配置。阶段 5 的主线，也是全项目唯一 parse 环境的地方。
 *
 * @remarks
 * ## 这一层和 `app/config.ts` 的分工（决定 D1）
 *
 * 两个模块看起来都在「校验配置」，但输入的类型不同，所以工具也不同：
 *
 * ```text
 * app/config.ts   输入 RunConfig          形状已被 tsc 保证    -> 手写 smart constructor
 *                 只需问「这个 number 合不合法」               产出品牌类型，构造不出非法值
 * infra/env.ts    输入 Record<string, string | undefined>      -> Zod
 *                 得先问「它是不是一个 number」                 未知形状 -> 已知形状
 * ```
 *
 * IMPORTANT: 判据是**输入形状是不是已经被 tsc 保证了**。是 -> Zod 只买到
 * 「把 tsc 已知的事再运行时说一遍」；不是 -> Zod 买到真正的 parse。
 * 仓库里两套校验风格并存是有意的，不是没统一。判据同步写进
 * `docs/decisions/0020-env-config.md`。
 *
 * ## 为什么不叫 ANTHROPIC_（决定 D7）
 *
 * TRAP: 2026-09 实测。Node 的 `--env-file` 只**补**进程里没有的变量，
 * 已经存在的一律不动。而 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL`
 * 是 SDK 和 Claude Code 都认的约定名，某些 shell 里本来就有值 ——
 * 于是 `.env` 被静默忽略，请求打到别的端点，而且不报错。
 * 私有的值要用私有的名字：`AGENT_*` 优先，`ANTHROPIC_*` 仍然接受但排在后面。
 *
 * NOTE: 阶段 4 用的是 `SMOKE_*`（那时只有冒烟脚本读环境）。现在读环境的不止
 * 脚本了，`SMOKE_` 这个名字名不副实,统一改成 `AGENT_`。
 *
 * @see docs/decisions/0020-env-config.md
 */
import { z } from "zod";
import type { Secret } from "../domain/secret.ts";
import { secretOf } from "../domain/secret.ts";
import type { Result } from "../domain/result.ts";
import { err, ok } from "../domain/result.ts";
import type { KnownModel } from "./anthropic/models.ts";
import { KNOWN_MODELS } from "./anthropic/models.ts";

/** 读环境变量的来源。IMPORTANT: 从外面传进来，这个模块不碰 `process.env`。 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** 私有前缀。优先级高于 {@link SHARED_PREFIX}。 */
export const OWN_PREFIX = "AGENT_";

/** 兼容前缀。SDK 的约定名，可能来自 shell 而不是 `.env`，所以排在后面。 */
export const SHARED_PREFIX = "ANTHROPIC_";

/**
 * 一条配置读不出来的原因。
 *
 * @remarks
 * IMPORTANT: `name` 是**用户要去设的那个环境变量名**，不是 Zod 的字段路径。
 * 验收标准是「说清缺什么」—— 报 `AUTH_TOKEN` 而不是 `AGENT_AUTH_TOKEN`
 * 会让人去改错地方。
 */
export type EnvIssue = {
  /** 带前缀的完整环境变量名，可以直接抄进 `.env`。 */
  readonly name: string;
  /** 人话。会原样打给用户看。 */
  readonly why: string;
};

/** 校验过的运行环境。SAFETY: `authToken` 是 {@link Secret}，打印不出来。 */
export type AppEnv = {
  readonly authToken: Secret<string>;
  readonly baseURL: string;
  readonly model: KnownModel;
  readonly maxTokens: number;
};

/**
 * schema。
 *
 * NOTE: 键名不带前缀 —— 前缀是「去哪儿找」的事，schema 管的是「找到之后长什么样」。
 * 两者混在一起的话，换前缀要改 schema。
 */
const Schema = z.object({
  AUTH_TOKEN: z.string().min(1),
  BASE_URL: z.url(),
  MODEL: z.enum(KNOWN_MODELS),
  MAX_TOKENS: z.coerce.number().int().positive().max(200000).default(1024),
});

/** 缺失和非法各自的人话。IMPORTANT: Zod 自带的英文原话不满足「说清缺什么」。 */
const ADVICE: Readonly<Record<string, { missing: string; invalid: string }>> = {
  AUTH_TOKEN: {
    missing: "没设。这是 provider 的 key，写进 MyAgent/.env，不要写进代码。",
    invalid: "是空串。空串按「没设」处理 —— 要么填上，要么整行删掉。",
  },
  BASE_URL: {
    missing: "没设。DeepSeek 兼容端点是 https://api.deepseek.com/anthropic",
    invalid:
      "不是一个完整 URL。要带协议，比如 https://api.deepseek.com/anthropic",
  },
  MODEL: {
    missing: `没设。认得的只有：${KNOWN_MODELS.join(" / ")}`,
    invalid: `不在认得的名单里。只有：${KNOWN_MODELS.join(" / ")}。供应商不校验模型名（实测），打错了它照常回答，所以这里必须挡。`,
  },
  MAX_TOKENS: {
    missing: "",
    invalid: "要是 1 到 200000 之间的整数。不设就用默认值 1024。",
  },
};

/**
 * 一个字段的值来自哪个环境变量名。
 *
 * @remarks
 * 空串按「没设」处理，和 {@link readEnv} 保持一致 ——
 * `.env` 里写 `AGENT_MODEL=` 的意思是「我还没填」，不是「我要一个空模型名」。
 *
 * @param source - 环境变量表
 * @param key - 不带前缀的字段名
 * @returns 实际生效的完整变量名，两个都没有时是 `undefined`
 */
export function sourceOf(source: EnvSource, key: string): string | undefined {
  const own = source[`${OWN_PREFIX}${key}`];
  if (own !== undefined && own !== "") return `${OWN_PREFIX}${key}`;
  const shared = source[`${SHARED_PREFIX}${key}`];
  if (shared !== undefined && shared !== "") return `${SHARED_PREFIX}${key}`;
  return undefined;
}

/** 取一个字段的原始值，私有名优先。空串按没设处理。 */
function pick(source: EnvSource, key: string): string | undefined {
  const from = sourceOf(source, key);
  return from === undefined ? undefined : source[from];
}

/**
 * 把环境变量读成配置。
 *
 * @remarks
 * IMPORTANT: 失败时返回**全部**问题，不是第一个。验收标准是「启动就失败并说清
 * 缺什么」—— 缺三个变量报一个、改完再报下一个，是三次启动才知道全貌。
 * Zod 的 `safeParse` 天然聚合，这条不用自己写。
 *
 * IMPORTANT: 返回 `Result` 而不是抛（决定 D3）。抛在这里会让「配置错了」和
 * 「代码有 bug」在调用点长得一模一样。转成退出码是组合根的事，见 `src/index.ts`。
 *
 * @param source - 环境变量表，通常是 `process.env`
 * @returns 校验过的配置，或者全部问题
 *
 * @example
 * ```ts
 * const env = readEnv(process.env);
 * if (!env.ok) {
 *   for (const i of env.error) console.error(`${i.name}  ${i.why}`);
 *   process.exit(1);
 * }
 * ```
 */
export function readEnv(
  source: EnvSource,
): Result<AppEnv, readonly EnvIssue[]> {
  const raw = {
    AUTH_TOKEN: pick(source, "AUTH_TOKEN"),
    BASE_URL: pick(source, "BASE_URL"),
    MODEL: pick(source, "MODEL"),
    MAX_TOKENS: pick(source, "MAX_TOKENS"),
  };

  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i): EnvIssue => {
      const key = String(i.path[0]);
      const advice = ADVICE[key];
      // NOTE: pick 已经把空串折成 undefined，所以「值不存在」只有一种形态
      const missing = raw[key as keyof typeof raw] === undefined;
      return {
        name: `${OWN_PREFIX}${key}`,
        why: (missing ? advice?.missing : advice?.invalid) ?? i.message,
      };
    });
    return err(issues);
  }

  return ok({
    authToken: secretOf(parsed.data.AUTH_TOKEN),
    baseURL: parsed.data.BASE_URL,
    model: parsed.data.MODEL,
    maxTokens: parsed.data.MAX_TOKENS,
  });
}
