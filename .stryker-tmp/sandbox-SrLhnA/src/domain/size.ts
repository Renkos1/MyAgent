/**
 * 文本大小的测量与截断。
 *
 * @remarks
 * IMPORTANT: 这个模块不认识 LoopBudget，也不 import loop.ts。
 * 它只回答两个问题：这段文本有多大、怎么把它切到指定大小以内。
 * 「切完之后预算怎么扣」是 input.ts 的事。
 *
 * 判上限只用 UTF-8 字节。measure 支持四种单位是为了可观测
 * （日志里同时记几个数字）—— NOTE: 别让第二个单位偷偷变成判据。
 *
 * SAFETY: 绝不按 UTF-16 下标切。实测 `"报告：👨‍👩‍👧".slice(0, 4)`
 * 会切出半个代理对，转 UTF-8 时原字符变成 U+FFFD 永久丢失。
 *
 * @see docs/decisions/0009-size-and-truncation.md  五个决定的候选、判据、代价
 */
// @ts-nocheck

/** 品牌符号。只声明不定义 —— 运行时不存在。 */ function stryNS_9fa48() {
  var g =
    (typeof globalThis === "object" &&
      globalThis &&
      globalThis.Math === Math &&
      globalThis) ||
    new Function("return this")();
  var ns = g.__stryker__ || (g.__stryker__ = {});
  if (
    ns.activeMutant === undefined &&
    g.process &&
    g.process.env &&
    g.process.env.__STRYKER_ACTIVE_MUTANT__
  ) {
    ns.activeMutant = g.process.env.__STRYKER_ACTIVE_MUTANT__;
  }
  function retrieveNS() {
    return ns;
  }
  stryNS_9fa48 = retrieveNS;
  return retrieveNS();
}
stryNS_9fa48();
function stryCov_9fa48() {
  var ns = stryNS_9fa48();
  var cov =
    ns.mutantCoverage ||
    (ns.mutantCoverage = {
      static: {},
      perTest: {},
    });
  function cover() {
    var c = cov.static;
    if (ns.currentTestId) {
      c = cov.perTest[ns.currentTestId] = cov.perTest[ns.currentTestId] || {};
    }
    var a = arguments;
    for (var i = 0; i < a.length; i++) {
      c[a[i]] = (c[a[i]] || 0) + 1;
    }
  }
  stryCov_9fa48 = cover;
  cover.apply(null, arguments);
}
function stryMutAct_9fa48(id) {
  var ns = stryNS_9fa48();
  function isActive(id) {
    if (ns.activeMutant === id) {
      if (ns.hitCount !== void 0 && ++ns.hitCount > ns.hitLimit) {
        throw new Error(
          "Stryker: Hit count limit reached (" + ns.hitCount + ")",
        );
      }
      return true;
    }
    return false;
  }
  stryMutAct_9fa48 = isActive;
  return isActive(id);
}
declare const unitBrand: unique symbol;
export type Utf8Bytes = number & {
  readonly [unitBrand]: "utf-8";
};
export type Utf16Units = number & {
  readonly [unitBrand]: "utf-16";
};
export type CodePoints = number & {
  readonly [unitBrand]: "code-point";
};
export type Graphemes = number & {
  readonly [unitBrand]: "grapheme";
};
export type UnitName = "utf-8" | "utf-16" | "code-point" | "grapheme";

/**
 * 单位名 → 对应的品牌数字类型。
 * measure 用它把「传进去的单位」和「返回的类型」绑在一起：
 * measure(t, "utf-8") 的类型是 Utf8Bytes，不是笼统的 number。
 *
 * IMPORTANT: 品牌只挡赋值，不挡算术（实测：Utf8Bytes + Graphemes 编译通过）。
 *   它防的是"把码点数当字节数传进去"，不防"把两种单位加起来"。
 */
type SizeOf = {
  "utf-8": Utf8Bytes;
  "utf-16": Utf16Units;
  "code-point": CodePoints;
  grapheme: Graphemes;
};

// 模块级复用：Segmenter 构造一次就够，它是纯的（同样输入同样输出）。
const segmenter = new Intl.Segmenter(
  undefined,
  stryMutAct_9fa48("401")
    ? {}
    : (stryCov_9fa48("401"),
      {
        granularity: stryMutAct_9fa48("402")
          ? ""
          : (stryCov_9fa48("402"), "grapheme"),
      }),
);
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
  if (stryMutAct_9fa48("403")) {
    {
    }
  } else {
    stryCov_9fa48("403");
    switch (unit) {
      case stryMutAct_9fa48("405") ? "" : (stryCov_9fa48("405"), "utf-8"):
        if (stryMutAct_9fa48("404")) {
        } else {
          stryCov_9fa48("404");
          return encoder.encode(text).length as SizeOf[U];
        }
      case stryMutAct_9fa48("407") ? "" : (stryCov_9fa48("407"), "utf-16"):
        if (stryMutAct_9fa48("406")) {
        } else {
          stryCov_9fa48("406");
          return text.length as SizeOf[U];
        }
      case stryMutAct_9fa48("409") ? "" : (stryCov_9fa48("409"), "code-point"):
        if (stryMutAct_9fa48("408")) {
        } else {
          stryCov_9fa48("408");
          // 规则的本意是"别拿展开当字符数用，emoji 会被拆开"。
          // 而这一支的语义正是「数码点」，拆开是正确行为 —— 要字素簇请传 "grapheme"。
          // eslint-disable-next-line @typescript-eslint/no-misused-spread -- 这里就是要码点
          return [...text].length as SizeOf[U];
        }
      default:
        if (stryMutAct_9fa48("410")) {
        } else {
          stryCov_9fa48("410");
          return [...segmenter.segment(text)].length as SizeOf[U];
        }
    }
  }
}

/**
 * 把文本截到 maxBytes 个 UTF-8 字节以内。
 *
 * 代码里的顺序和 ADR 0009 §③ 的叙述相反（先字素簇后换行），但结果一致：
 * 先退到字素簇边界，保证不切碎字符；再在这个安全前缀里找最后一个换行。
 * 「换行优先」等价于「安全前缀内的最后一个换行」—— 反过来做会先切碎再找。
 *
 * @returns 截断后的文本。NOTE: 可能是空串 —— 那是调用方要判的事（ADR 0009 §⑤）。
 */
export function truncateToBytes(text: string, maxBytes: number): string {
  if (stryMutAct_9fa48("411")) {
    {
    }
  } else {
    stryCov_9fa48("411");
    if (
      stryMutAct_9fa48("415")
        ? measure(text, "utf-8") > maxBytes
        : stryMutAct_9fa48("414")
          ? measure(text, "utf-8") < maxBytes
          : stryMutAct_9fa48("413")
            ? false
            : stryMutAct_9fa48("412")
              ? true
              : (stryCov_9fa48("412", "413", "414", "415"),
                measure(
                  text,
                  stryMutAct_9fa48("416")
                    ? ""
                    : (stryCov_9fa48("416"), "utf-8"),
                ) <= maxBytes)
    )
      return text;

    // 逐个字素簇累加，一超就停 —— 永远停在字符边界上
    const kept: string[] = stryMutAct_9fa48("417")
      ? ["Stryker was here"]
      : (stryCov_9fa48("417"), []);
    let used = 0;
    for (const { segment } of segmenter.segment(text)) {
      if (stryMutAct_9fa48("418")) {
        {
        }
      } else {
        stryCov_9fa48("418");
        const size = measure(
          segment,
          stryMutAct_9fa48("419") ? "" : (stryCov_9fa48("419"), "utf-8"),
        );
        if (
          stryMutAct_9fa48("423")
            ? used + size <= maxBytes
            : stryMutAct_9fa48("422")
              ? used + size >= maxBytes
              : stryMutAct_9fa48("421")
                ? false
                : stryMutAct_9fa48("420")
                  ? true
                  : (stryCov_9fa48("420", "421", "422", "423"),
                    (stryMutAct_9fa48("424")
                      ? used - size
                      : (stryCov_9fa48("424"), used + size)) > maxBytes)
        )
          break;
        if (stryMutAct_9fa48("425")) {
        } else {
          stryCov_9fa48("425");
          kept.push(segment);
        }
        stryMutAct_9fa48("426")
          ? (used -= size)
          : (stryCov_9fa48("426"), (used += size));
      }
    }
    const safe = kept.join(
      stryMutAct_9fa48("427")
        ? "Stryker was here!"
        : (stryCov_9fa48("427"), ""),
    );

    // 在安全前缀里退到最近的换行（保留换行本身，看起来像自然结束）
    const lastNewline = safe.lastIndexOf(
      stryMutAct_9fa48("428") ? "" : (stryCov_9fa48("428"), "\n"),
    );
    return (
      stryMutAct_9fa48("432")
        ? lastNewline < 0
        : stryMutAct_9fa48("431")
          ? lastNewline > 0
          : stryMutAct_9fa48("430")
            ? false
            : stryMutAct_9fa48("429")
              ? true
              : (stryCov_9fa48("429", "430", "431", "432"), lastNewline >= 0)
    )
      ? stryMutAct_9fa48("433")
        ? safe
        : (stryCov_9fa48("433"),
          safe.slice(
            0,
            stryMutAct_9fa48("434")
              ? lastNewline - 1
              : (stryCov_9fa48("434"), lastNewline + 1),
          ))
      : safe;
  }
}
