// @ts-nocheck
function stryNS_9fa48() {
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
import type { Result } from "./result.ts";
import { err, ok } from "./result.ts";

/**
 * agent 主循环的预算：模型调用次数和工具执行次数各一个上限。
 *
 * @remarks
 * 纯的那一半：只做加法和比较。不调模型、不执行工具、不看时钟、不碰 AbortSignal。
 *
 * IMPORTANT: 主循环里决定「还要不要再转一圈」的是模型自己，而模型是概率性的 ——
 * 没有任何东西保证它会在有限步内说「我说完了」。
 * 轮次上限是这个循环里**唯一一个不依赖模型配合的终止保证**。
 *
 * 用词：**上限**是配的那个数，**预算**是上限 + 已用。见 docs/glossary.md。
 *
 * @see docs/decisions/0010-loop-budget.md  七个决定的候选、判据、代价
 * @see docs/decisions/0005-tool-run-permit.md  reserveToolRuns 在 ⑥ 之上叠的那一层
 */
/** 品牌符号。只声明不定义 —— 运行时不存在，只在类型层面挡人。 */
declare const brand: unique symbol;

/** 哪一个上限。NOTE: 两者的处理方式相同，所以是同一个 kind 的参数，不是两个 kind。 */
export type LimitName =
  "model-calls" | "tool-runs" | "input-bytes-per-item" | "input-bytes-total";

/** 构造时上限值非法。来自配置，所以可以带上原值。 */
export type InvalidLimit = {
  readonly kind: "invalid-limit";
  readonly limit: LimitName;
  readonly value: number;
};

/**
 * 一个「应该是正整数的数量」不是正整数。来自适配器读到的响应，
 * 同样是自己的东西，所以带上原值。
 *
 * IMPORTANT: turn.ts 复用这一个，不再自己定义 invalid-tool-count ——
 * 同一个概念只能有一个名字（词表 docs/glossary.md）。
 */
export type InvalidCount = {
  readonly kind: "invalid-count";
  readonly value: number;
};

/**
 * 预算不够做这件事。used 是已经用掉的，max 是上限。
 *
 * IMPORTANT: 名字不叫 limit-reached，也不叫 budget-exhausted ——
 *   那两个名字在原子拒绝的情形下是事实错误：
 *   max=5、used=3，一次要跑 3 个工具 → 报错，但上限没被 reached，
 *   预算也没 exhausted。准确的说法只有「不够」。见 docs/decisions/0002。
 */
export type InsufficientBudget = {
  readonly kind: "insufficient-budget";
  readonly limit: LimitName;
  readonly used: number;
  readonly max: number;
};
export type LoopLimits = {
  readonly maxModelCalls: number;
  readonly maxToolRuns: number;
  /** 单个文本的字节上限。由 input.ts 判 —— 它是无状态的规则。 */
  readonly maxInputBytesPerItem: number;
  /** 累计输入的字节上限。由本模块的 recordInputBytes 判 —— 它需要状态。 */
  readonly maxInputBytesTotal: number;
};

/**
 * 循环预算的当前状态。
 *
 * 带品牌，只能由 createLoopBudget 产出 —— 拿到一个 LoopBudget 就等于
 * 它的上限已经校验过了，转换函数不必再查一遍。
 * 这就是「让非法状态无法被表示」在 TS 里的落地形态。
 */
export type LoopBudget = {
  readonly limits: LoopLimits;
  readonly modelCalls: number;
  readonly toolRuns: number;
  readonly inputBytes: number;
  readonly [brand]: true;
};

/**
 * 合法的次数：安全整数且至少为 1。见 ADR 0010 §③。
 * 导出给 turn.ts 用 —— 它判 toolCount 用的是同一条规则，
 * 抄一份就会有两个地方要同时改对。
 */
export function isValidCount(n: number): boolean {
  if (stryMutAct_9fa48("263")) {
    {
    }
  } else {
    stryCov_9fa48("263");
    return stryMutAct_9fa48("266")
      ? Number.isSafeInteger(n) || n >= 1
      : stryMutAct_9fa48("265")
        ? false
        : stryMutAct_9fa48("264")
          ? true
          : (stryCov_9fa48("264", "265", "266"),
            Number.isSafeInteger(n) &&
              (stryMutAct_9fa48("269")
                ? n < 1
                : stryMutAct_9fa48("268")
                  ? n > 1
                  : stryMutAct_9fa48("267")
                    ? true
                    : (stryCov_9fa48("267", "268", "269"), n >= 1)));
  }
}

/** 校验上限并构造初始状态。这是拿到 LoopBudget 的唯一入口。 */
export function createLoopBudget(
  limits: LoopLimits,
): Result<LoopBudget, InvalidLimit> {
  if (stryMutAct_9fa48("270")) {
    {
    }
  } else {
    stryCov_9fa48("270");
    if (
      stryMutAct_9fa48("273")
        ? false
        : stryMutAct_9fa48("272")
          ? true
          : stryMutAct_9fa48("271")
            ? isValidCount(limits.maxModelCalls)
            : (stryCov_9fa48("271", "272", "273"),
              !isValidCount(limits.maxModelCalls))
    ) {
      if (stryMutAct_9fa48("274")) {
        {
        }
      } else {
        stryCov_9fa48("274");
        return err(
          stryMutAct_9fa48("275")
            ? {}
            : (stryCov_9fa48("275"),
              {
                kind: stryMutAct_9fa48("276")
                  ? ""
                  : (stryCov_9fa48("276"), "invalid-limit"),
                limit: stryMutAct_9fa48("277")
                  ? ""
                  : (stryCov_9fa48("277"), "model-calls"),
                value: limits.maxModelCalls,
              }),
        );
      }
    }
    if (
      stryMutAct_9fa48("280")
        ? false
        : stryMutAct_9fa48("279")
          ? true
          : stryMutAct_9fa48("278")
            ? isValidCount(limits.maxToolRuns)
            : (stryCov_9fa48("278", "279", "280"),
              !isValidCount(limits.maxToolRuns))
    ) {
      if (stryMutAct_9fa48("281")) {
        {
        }
      } else {
        stryCov_9fa48("281");
        return err(
          stryMutAct_9fa48("282")
            ? {}
            : (stryCov_9fa48("282"),
              {
                kind: stryMutAct_9fa48("283")
                  ? ""
                  : (stryCov_9fa48("283"), "invalid-limit"),
                limit: stryMutAct_9fa48("284")
                  ? ""
                  : (stryCov_9fa48("284"), "tool-runs"),
                value: limits.maxToolRuns,
              }),
        );
      }
    }
    if (
      stryMutAct_9fa48("287")
        ? false
        : stryMutAct_9fa48("286")
          ? true
          : stryMutAct_9fa48("285")
            ? isValidCount(limits.maxInputBytesPerItem)
            : (stryCov_9fa48("285", "286", "287"),
              !isValidCount(limits.maxInputBytesPerItem))
    ) {
      if (stryMutAct_9fa48("288")) {
        {
        }
      } else {
        stryCov_9fa48("288");
        return err(
          stryMutAct_9fa48("289")
            ? {}
            : (stryCov_9fa48("289"),
              {
                kind: stryMutAct_9fa48("290")
                  ? ""
                  : (stryCov_9fa48("290"), "invalid-limit"),
                limit: stryMutAct_9fa48("291")
                  ? ""
                  : (stryCov_9fa48("291"), "input-bytes-per-item"),
                value: limits.maxInputBytesPerItem,
              }),
        );
      }
    }
    if (
      stryMutAct_9fa48("294")
        ? false
        : stryMutAct_9fa48("293")
          ? true
          : stryMutAct_9fa48("292")
            ? isValidCount(limits.maxInputBytesTotal)
            : (stryCov_9fa48("292", "293", "294"),
              !isValidCount(limits.maxInputBytesTotal))
    ) {
      if (stryMutAct_9fa48("295")) {
        {
        }
      } else {
        stryCov_9fa48("295");
        return err(
          stryMutAct_9fa48("296")
            ? {}
            : (stryCov_9fa48("296"),
              {
                kind: stryMutAct_9fa48("297")
                  ? ""
                  : (stryCov_9fa48("297"), "invalid-limit"),
                limit: stryMutAct_9fa48("298")
                  ? ""
                  : (stryCov_9fa48("298"), "input-bytes-total"),
                value: limits.maxInputBytesTotal,
              }),
        );
      }
    }
    return ok({
      limits,
      modelCalls: 0,
      toolRuns: 0,
      inputBytes: 0,
    } as LoopBudget);
  }
}

/** 记一次模型调用。到上限则拒绝，状态不变。 */
export function recordModelCall(
  state: LoopBudget,
): Result<LoopBudget, InsufficientBudget> {
  if (stryMutAct_9fa48("299")) {
    {
    }
  } else {
    stryCov_9fa48("299");
    const { maxModelCalls } = state.limits;
    if (
      stryMutAct_9fa48("303")
        ? state.modelCalls < maxModelCalls
        : stryMutAct_9fa48("302")
          ? state.modelCalls > maxModelCalls
          : stryMutAct_9fa48("301")
            ? false
            : stryMutAct_9fa48("300")
              ? true
              : (stryCov_9fa48("300", "301", "302", "303"),
                state.modelCalls >= maxModelCalls)
    ) {
      if (stryMutAct_9fa48("304")) {
        {
        }
      } else {
        stryCov_9fa48("304");
        return err(
          stryMutAct_9fa48("305")
            ? {}
            : (stryCov_9fa48("305"),
              {
                kind: stryMutAct_9fa48("306")
                  ? ""
                  : (stryCov_9fa48("306"), "insufficient-budget"),
                limit: stryMutAct_9fa48("307")
                  ? ""
                  : (stryCov_9fa48("307"), "model-calls"),
                used: state.modelCalls,
                max: maxModelCalls,
              }),
        );
      }
    }
    return ok(
      stryMutAct_9fa48("308")
        ? {}
        : (stryCov_9fa48("308"),
          {
            ...state,
            modelCalls: stryMutAct_9fa48("309")
              ? state.modelCalls - 1
              : (stryCov_9fa48("309"), state.modelCalls + 1),
          }),
    );
  }
}

/**
 * 记一批工具执行。count 是这一次响应里要并行跑的工具个数。
 * 预算不够时一个都不跑（ADR 0010 §⑥ 的原子性）。
 */
export function recordToolRuns(
  state: LoopBudget,
  count: number,
): Result<LoopBudget, InsufficientBudget | InvalidCount> {
  if (stryMutAct_9fa48("310")) {
    {
    }
  } else {
    stryCov_9fa48("310");
    if (
      stryMutAct_9fa48("313")
        ? false
        : stryMutAct_9fa48("312")
          ? true
          : stryMutAct_9fa48("311")
            ? isValidCount(count)
            : (stryCov_9fa48("311", "312", "313"), !isValidCount(count))
    ) {
      if (stryMutAct_9fa48("314")) {
        {
        }
      } else {
        stryCov_9fa48("314");
        return err(
          stryMutAct_9fa48("315")
            ? {}
            : (stryCov_9fa48("315"),
              {
                kind: stryMutAct_9fa48("316")
                  ? ""
                  : (stryCov_9fa48("316"), "invalid-count"),
                value: count,
              }),
        );
      }
    }
    const { maxToolRuns } = state.limits;
    if (
      stryMutAct_9fa48("320")
        ? state.toolRuns + count <= maxToolRuns
        : stryMutAct_9fa48("319")
          ? state.toolRuns + count >= maxToolRuns
          : stryMutAct_9fa48("318")
            ? false
            : stryMutAct_9fa48("317")
              ? true
              : (stryCov_9fa48("317", "318", "319", "320"),
                (stryMutAct_9fa48("321")
                  ? state.toolRuns - count
                  : (stryCov_9fa48("321"), state.toolRuns + count)) >
                  maxToolRuns)
    ) {
      if (stryMutAct_9fa48("322")) {
        {
        }
      } else {
        stryCov_9fa48("322");
        return err(
          stryMutAct_9fa48("323")
            ? {}
            : (stryCov_9fa48("323"),
              {
                kind: stryMutAct_9fa48("324")
                  ? ""
                  : (stryCov_9fa48("324"), "insufficient-budget"),
                limit: stryMutAct_9fa48("325")
                  ? ""
                  : (stryCov_9fa48("325"), "tool-runs"),
                used: state.toolRuns,
                max: maxToolRuns,
              }),
        );
      }
    }
    return ok(
      stryMutAct_9fa48("326")
        ? {}
        : (stryCov_9fa48("326"),
          {
            ...state,
            toolRuns: stryMutAct_9fa48("327")
              ? state.toolRuns - count
              : (stryCov_9fa48("327"), state.toolRuns + count),
          }),
    );
  }
}

/**
 * 记一段输入的字节数。只判总和 —— 单个文本的上限是无状态规则，
 * 由 input.ts 在测量的时候就地判掉，不必进到状态里。
 *
 * 和 recordToolRuns 一样是原子的：预算不够就一个字节都不记（ADR 0010 §⑥）。
 */
export function recordInputBytes(
  state: LoopBudget,
  bytes: number,
): Result<LoopBudget, InsufficientBudget | InvalidCount> {
  if (stryMutAct_9fa48("328")) {
    {
    }
  } else {
    stryCov_9fa48("328");
    if (
      stryMutAct_9fa48("331")
        ? !Number.isSafeInteger(bytes) && bytes < 0
        : stryMutAct_9fa48("330")
          ? false
          : stryMutAct_9fa48("329")
            ? true
            : (stryCov_9fa48("329", "330", "331"),
              (stryMutAct_9fa48("332")
                ? Number.isSafeInteger(bytes)
                : (stryCov_9fa48("332"), !Number.isSafeInteger(bytes))) ||
                (stryMutAct_9fa48("335")
                  ? bytes >= 0
                  : stryMutAct_9fa48("334")
                    ? bytes <= 0
                    : stryMutAct_9fa48("333")
                      ? false
                      : (stryCov_9fa48("333", "334", "335"), bytes < 0)))
    ) {
      if (stryMutAct_9fa48("336")) {
        {
        }
      } else {
        stryCov_9fa48("336");
        return err(
          stryMutAct_9fa48("337")
            ? {}
            : (stryCov_9fa48("337"),
              {
                kind: stryMutAct_9fa48("338")
                  ? ""
                  : (stryCov_9fa48("338"), "invalid-count"),
                value: bytes,
              }),
        );
      }
    }
    const { maxInputBytesTotal } = state.limits;
    if (
      stryMutAct_9fa48("342")
        ? state.inputBytes + bytes <= maxInputBytesTotal
        : stryMutAct_9fa48("341")
          ? state.inputBytes + bytes >= maxInputBytesTotal
          : stryMutAct_9fa48("340")
            ? false
            : stryMutAct_9fa48("339")
              ? true
              : (stryCov_9fa48("339", "340", "341", "342"),
                (stryMutAct_9fa48("343")
                  ? state.inputBytes - bytes
                  : (stryCov_9fa48("343"), state.inputBytes + bytes)) >
                  maxInputBytesTotal)
    ) {
      if (stryMutAct_9fa48("344")) {
        {
        }
      } else {
        stryCov_9fa48("344");
        return err(
          stryMutAct_9fa48("345")
            ? {}
            : (stryCov_9fa48("345"),
              {
                kind: stryMutAct_9fa48("346")
                  ? ""
                  : (stryCov_9fa48("346"), "insufficient-budget"),
                limit: stryMutAct_9fa48("347")
                  ? ""
                  : (stryCov_9fa48("347"), "input-bytes-total"),
                used: state.inputBytes,
                max: maxInputBytesTotal,
              }),
        );
      }
    }
    return ok(
      stryMutAct_9fa48("348")
        ? {}
        : (stryCov_9fa48("348"),
          {
            ...state,
            inputBytes: stryMutAct_9fa48("349")
              ? state.inputBytes - bytes
              : (stryCov_9fa48("349"), state.inputBytes + bytes),
          }),
    );
  }
}
declare const permit: unique symbol;

/**
 * 跑工具的许可证。
 *
 * @remarks
 * 只能由 {@link reserveToolRuns} 产出，而用例层的 `runTools` 必须收它才肯跑。
 * 于是「先扣预算，再跑工具」这条顺序由编译器保证 ——
 * 在此之前它只写在一行注释里，而注释会跟着代码一起被搬走（2026-09 真实发生过）。
 *
 * `next` 是扣完之后的新预算；`count` 是这张许可证批准跑几个。
 */
export type ToolRunPermit = {
  readonly next: LoopBudget;
  readonly count: number;
  readonly [permit]: true;
};

/**
 * 扣工具预算，同时确认跑完之后还问得起模型。
 *
 * @remarks
 * 阶段 1 的 `decide` 曾经保证过这件事（「问不起就别跑那些工具」），
 * 但预算检查从 decide 搬走时这条保证丢了 —— 于是出现「工具白跑」：
 * 花了 IO、花了工具额度，结果没有额度再问模型，没人看那些结果。
 *
 * IMPORTANT: 模型额度这里只探测不扣。下一轮开头的 `recordModelCall` 才真扣。
 * 探测复用 {@link recordModelCall} 的实现而不是复制它的判断 ——
 * 复制出来的两份谓词迟早漂移。
 *
 * @param state - 当前预算（本轮的模型调用已经扣过了）
 * @param count - 这一批要跑几个工具
 * @returns 许可证，或者第一个不够的额度
 * @see docs/decisions/0005-tool-run-permit.md
 */
export function reserveToolRuns(
  state: LoopBudget,
  count: number,
): Result<ToolRunPermit, InsufficientBudget | InvalidCount> {
  if (stryMutAct_9fa48("350")) {
    {
    }
  } else {
    stryCov_9fa48("350");
    const spent = recordToolRuns(state, count);
    if (
      stryMutAct_9fa48("353")
        ? false
        : stryMutAct_9fa48("352")
          ? true
          : stryMutAct_9fa48("351")
            ? spent.ok
            : (stryCov_9fa48("351", "352", "353"), !spent.ok)
    )
      return spent;

    // NOTE: 报的是 model-calls —— 「工具跑不了」的原因是「跑完问不起」，
    //       所以描述用户实际拿不到什么的那个字段是模型额度，不是工具额度。
    const probe = recordModelCall(spent.value);
    if (
      stryMutAct_9fa48("356")
        ? false
        : stryMutAct_9fa48("355")
          ? true
          : stryMutAct_9fa48("354")
            ? probe.ok
            : (stryCov_9fa48("354", "355", "356"), !probe.ok)
    )
      return err(probe.error);

    // TRAP: 不能写 `[permit]: true` —— `declare const permit` 是纯类型声明，
    //       运行时没有这个绑定，当计算属性键用会 ReferenceError。
    //       tsc / lint / arch 全绿，只有真跑测试才炸（2026-09 实测）。
    //       品牌只活在类型里，构造时用 as 断言 —— 和 createLoopBudget 一致。
    return ok({
      next: spent.value,
      count,
    } as ToolRunPermit);
  }
}
