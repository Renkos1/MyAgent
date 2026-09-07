/**
 * 认得的模型名 —— 一个闭集，不是一条正则。
 *
 * @remarks
 * 这个文件存在的唯一理由写在 `providers.ts` 的 SAFETY 里：
 * DeepSeek 兼容端点的 `validatesModelName` 是 `"no"`，2026-09 实测 ——
 * 模型名写成不存在的，它照常回答，请求被别的模型接走，**没有任何信号**。
 * 供应商不挡，就只能自己挡。
 *
 * IMPORTANT: 判据和 ADR 0013 §② 的判分点是同一条 ——
 * **闭集不是正则**。`/^claude-/` 这种写法挡不住 `claude-haiku-4-5-2025100`
 * （少一位），只会安静地永远匹配成功。闭集少一位就是不在集合里。
 *
 * TRAP: 加一个新模型名要改这个文件。那不是麻烦，那是**要的信号** ——
 * 换模型是一次会改变成本、延迟和通过率的事，它应该出现在 diff 里。
 *
 * NOTE: 集合里只放**真的发出去过请求**的名字。没跑过的一律不进 ——
 * 同 `providers.ts` 的规矩：抄文档写进代码，就是把别人的文档当自己的实测。
 */

/**
 * 发出去过、拿到过正常响应的模型名。
 *
 * @remarks
 * 逐条来源：
 *
 * ```text
 * deepseek-v4-flash            阶段 4 全部 probe-* 探针 + test/cassettes/ 5 盘带子
 * claude-haiku-4-5-20251001    阶段 4 轮 A smoke 的默认值（DeepSeek 按档位映射到 flash）
 * ```
 *
 * IMPORTANT: `deepseek-v4-pro` / `claude-opus-*` **故意不在这里** ——
 * 没跑过。要用它，先跑一次 `pnpm smoke` 再回来加一行，附上日期。
 */
export const KNOWN_MODELS = [
  "deepseek-v4-flash",
  "claude-haiku-4-5-20251001",
] as const;

/** 闭集里的一个成员。IMPORTANT: 这是类型，不是 `string` —— 拼错编译期就红。 */
export type KnownModel = (typeof KNOWN_MODELS)[number];

/**
 * 这个字符串是不是认得的模型名。
 *
 * @param v - 从环境变量里读出来的原始值
 * @returns 是则收窄成 {@link KnownModel}
 */
export function isKnownModel(v: string): v is KnownModel {
  return (KNOWN_MODELS as readonly string[]).includes(v);
}
