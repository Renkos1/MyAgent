/**
 * 造一个「已经用掉一些额度」的 LoopBudget。
 *
 * ★只能通过真实的转换函数推进★ —— 品牌类型不许直接拼 LoopBudget，
 * 这反过来保证脚手架造出来的状态是循环里真会出现的形状。
 *
 * ⚠ 2026-09 从 test/domain/turn.test.ts 搬过来：decide 不再收 LoopBudget，
 *   那个文件已经完全不碰预算了。★用它的是用例层的测试。★
 */
import type { LoopBudget } from "../../src/domain/loop.ts";
import {
  createLoopBudget,
  recordModelCall,
  recordToolRuns,
} from "../../src/domain/loop.ts";

const BYTES = { maxInputBytesPerItem: 4096, maxInputBytesTotal: 65536 };

export function stateWith(opts: {
  maxModelCalls: number;
  maxToolRuns: number;
  modelCalls?: number;
  toolRuns?: number;
}): LoopBudget {
  const created = createLoopBudget({
    maxModelCalls: opts.maxModelCalls,
    maxToolRuns: opts.maxToolRuns,
    ...BYTES,
  });
  if (!created.ok) throw new Error(`脚手架：上限非法 ${created.error.limit}`);

  let state = created.value;
  for (let i = 0; i < (opts.modelCalls ?? 0); i++) {
    const r = recordModelCall(state);
    if (!r.ok) throw new Error("脚手架：模型额度不够，用例参数写错了");
    state = r.value;
  }
  if (opts.toolRuns) {
    const r = recordToolRuns(state, opts.toolRuns);
    if (!r.ok) throw new Error("脚手架：工具额度不够，用例参数写错了");
    state = r.value;
  }
  return state;
}
