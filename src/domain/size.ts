/**
 * 文本大小的测量与截断。
 *
 * ★这个模块不认识 LoopBudget，也不 import loop.ts。★
 * 它只回答两个问题：这段文本有多大、怎么把它切到指定大小以内。
 * 「切完之后预算怎么扣」是 input.ts 的事。
 *
 * ── 契约 ────────────────────────────────────────────────────────
 *
 * ① 上限用什么单位量？
 *      ★UTF-8 字节★。
 *      理由：上限最终要和"落盘 / 过网络 / 进 Buffer"的数字对齐，
 *            只有字节是那个数字。UTF-16 length 和字节能差 3 倍
 *            （中文），和字素簇能差 18 倍（ZWJ emoji）。
 *      代价：对用户说"限制 4096"时，中文只有约 1365 个字。
 *      ⚠ measure 支持四种单位是为了★可观测★（日志里同时记几个数字），
 *        但★判上限只用 utf-8★。别让第二个单位偷偷变成判据。
 *
 * ② 超限了：拒绝还是截断？
 *      ★由调用方每次指定★（LimitMode）。
 *      理由：读一个源文件截断是合理的；读一份配置截断就是错的。
 *            这个判断只有调用点知道。
 *      代价：调用方每次都要选，选错没人拦。
 *
 * ③ 截断在哪一刀？
 *      ★优先退到最近的换行；没有换行就退到最近的字素簇边界。★
 *      理由：换行是语义边界，切出来的东西人还能读；
 *            字素簇边界保证★永远不切碎一个字符★。
 *      ⚠ 绝不按 UTF-16 下标切：实测 "报告：👨‍👩‍👧".slice(0,4)
 *        会切出半个代理对，转 UTF-8 时原字符变成 U+FFFD 永久丢失。
 *      代价：实际保留的字节数会小于上限，有时小很多（一整段没换行时）。
 *
 * ④ 单个上限还是总和上限？
 *      ★两个都要，而且分工不同★：
 *        单个（perItem） 防"一个大文件打死进程"，是★无状态的规则★
 *        总和（total）   防"每个都不超但加起来超"，是★需要状态的规则★
 *      所以单个在这里判，总和在 loop.ts 的计数器上判。
 *
 * ⑤ 空文本合法吗？
 *      ★本来就空 → 合法★（0 字节的文件是真实存在的东西）
 *      ★被截断成空 → 非法★（调用方要的是内容，给它空串等于骗它）
 *      这两者由 input.ts 区分，本模块只负责返回截断结果。
 */

/** 品牌符号。只声明不定义 —— 运行时不存在。 */
declare const unitBrand: unique symbol;

export type Utf8Bytes = number & { readonly [unitBrand]: "utf-8" };
export type Utf16Units = number & { readonly [unitBrand]: "utf-16" };
export type CodePoints = number & { readonly [unitBrand]: "code-point" };
export type Graphemes = number & { readonly [unitBrand]: "grapheme" };

export type UnitName = "utf-8" | "utf-16" | "code-point" | "grapheme";

/**
 * 单位名 → 对应的品牌数字类型。
 * measure 用它把「传进去的单位」和「返回的类型」绑在一起：
 * measure(t, "utf-8") 的类型是 Utf8Bytes，不是笼统的 number。
 *
 * ⚠ 品牌只挡★赋值★，不挡★算术★（实测：Utf8Bytes + Graphemes 编译通过）。
 *   它防的是"把码点数当字节数传进去"，不防"把两种单位加起来"。
 */
type SizeOf = {
  "utf-8": Utf8Bytes;
  "utf-16": Utf16Units;
  "code-point": CodePoints;
  grapheme: Graphemes;
};

// 模块级复用：Segmenter 构造一次就够，它是纯的（同样输入同样输出）。
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const encoder = new TextEncoder();

/**
 * 量一段文本。
 *
 * 用 TextEncoder 而不是 Buffer.byteLength：前者是 Web 标准，
 * 领域层因此不依赖 node: 任何东西（阶段 2 划边界时会省事）。
 * 代价：TextEncoder 会真的分配一次数组，Buffer.byteLength 不会。
 * 文本已经在内存里，这点分配可以接受。
 */
export function measure<U extends UnitName>(text: string, unit: U): SizeOf[U] {
  switch (unit) {
    case "utf-8":
      return encoder.encode(text).length as SizeOf[U];
    case "utf-16":
      return text.length as SizeOf[U];
    case "code-point":
      // 规则的本意是"别拿展开当字符数用，emoji 会被拆开"。
      // 而这一支的语义★正是"数码点"★，拆开是正确行为 —— 要字素簇请传 "grapheme"。
      // eslint-disable-next-line @typescript-eslint/no-misused-spread -- 这里就是要码点
      return [...text].length as SizeOf[U];
    default:
      return [...segmenter.segment(text)].length as SizeOf[U];
  }
}

/**
 * 把文本截到 maxBytes 个 UTF-8 字节以内。
 *
 * 代码里的顺序和契约③的叙述相反（先字素簇后换行），但结果一致：
 * 先退到字素簇边界，保证不切碎字符；再在这个安全前缀里找最后一个换行。
 * 「换行优先」等价于「安全前缀内的最后一个换行」—— 反过来做会先切碎再找。
 *
 * @returns 截断后的文本。可能是空串 —— ★那是调用方要判的事★（契约⑤）。
 */
export function truncateToBytes(text: string, maxBytes: number): string {
  if (measure(text, "utf-8") <= maxBytes) return text;

  // 逐个字素簇累加，一超就停 —— 永远停在字符边界上
  const kept: string[] = [];
  let used = 0;
  for (const { segment } of segmenter.segment(text)) {
    const size = measure(segment, "utf-8");
    if (used + size > maxBytes) break;
    kept.push(segment);
    used += size;
  }
  const safe = kept.join("");

  // 在安全前缀里退到最近的换行（保留换行本身，看起来像自然结束）
  const lastNewline = safe.lastIndexOf("\n");
  return lastNewline >= 0 ? safe.slice(0, lastNewline + 1) : safe;
}
