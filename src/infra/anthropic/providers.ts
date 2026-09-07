/**
 * 能力矩阵 —— 每一格都是跑出来的，不是抄文档的。
 *
 * @remarks
 * 阶段 4 的验收标准是「能力差异写进代码而不是文档」。这个文件就是那句话的实现：
 * 调用方拿到的是 {@link ProviderCapabilities}，编译器能看见，`switch` 能穷举。
 *
 * IMPORTANT: 改这里的任何一格，都要同时说出是哪个 `scripts/probe-*.ts`
 * 在哪一天跑出来的。没有实测来源的格子一律写 `unknown` ——
 * 「不知道」和「不支持」是两件事。
 *
 * 测量记录见 ts-modern-train `docs/experience.md`。
 */
import type { ProviderCapabilities } from "../../app/ports.ts";

/**
 * Anthropic 官方端点。
 *
 * @remarks
 * IMPORTANT: 本项目**没有官方 key**，所以这一份里带 `unknown` 的格子是诚实的，
 * 不是偷懒。有 key 之后把 `scripts/probe-*.ts` 对着官方 baseURL 再跑一遍，
 * 逐格填掉。
 *
 * `verifiesThinkingSignature: "unknown"` 特别值得留着：官方文档说
 * extended thinking + 工具调用时 thinking 块要原样带回，但**我们没验过**。
 * 写 `yes` 就是把别人的文档当自己的实测。
 */
export const ANTHROPIC_OFFICIAL: ProviderCapabilities = {
  toolUse: "unknown",
  parallelToolUse: "unknown",
  streaming: "unknown",
  midConversationSystem: "unknown",
  promptCaching: "unknown",
  verifiesThinkingSignature: "unknown",
  validatesModelName: "unknown",
};

/**
 * DeepSeek 的 Anthropic 兼容端点（`https://api.deepseek.com/anthropic`）。
 *
 * @remarks
 * 2026-09 实测，模型 `deepseek-v4-flash`。逐格来源：
 *
 * ```text
 * toolUse                  probe-tools ①  stop_reason "tool_use"
 * parallelToolUse          probe-tools ②  一条消息里两个 tool_use 块
 * streaming                probe-stream   两条不变量都成立
 * midConversationSystem    roadmap 的事实表：messages[] 里 role:"system" 直接 400
 * promptCaching            probe-tools    没传 cache_control，
 *                                         第二次起 cache_read_input_tokens=384
 * verifiesThinkingSignature probe-roundtrip 丢掉 thinking 再发回，成功
 * validatesModelName       probe-errors ② 模型名写成不存在的，照常回答
 * ```
 *
 * SAFETY: `validatesModelName: "no"` 是这张表里最危险的一格 ——
 * 模型名打错不报错，请求被别的模型接走，没有任何信号。
 * 阶段 5 做配置层时，模型名要自己校验，不能指望供应商挡。
 */
export const DEEPSEEK_COMPAT: ProviderCapabilities = {
  toolUse: "yes",
  parallelToolUse: "yes",
  streaming: "yes",
  midConversationSystem: "no",
  promptCaching: "automatic",
  verifiesThinkingSignature: "no",
  validatesModelName: "no",
};
