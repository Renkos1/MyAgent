/**
 * 领域层的错误表达方式：失败是返回值的一部分，不是异常。
 *
 * 决策见 ts-modern-train 的 docs/03「架构决策清单」第 1 条：
 * 领域和用例层用 Result，边界层（HTTP / CLI）才转成异常和状态码。
 */
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
export type Result<T, E> =
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
      readonly error: E;
    };
export function ok<T>(value: T): Result<T, never> {
  if (stryMutAct_9fa48("395")) {
    {
    }
  } else {
    stryCov_9fa48("395");
    return stryMutAct_9fa48("396")
      ? {}
      : (stryCov_9fa48("396"),
        {
          ok: stryMutAct_9fa48("397") ? false : (stryCov_9fa48("397"), true),
          value,
        });
  }
}
export function err<E>(error: E): Result<never, E> {
  if (stryMutAct_9fa48("398")) {
    {
    }
  } else {
    stryCov_9fa48("398");
    return stryMutAct_9fa48("399")
      ? {}
      : (stryCov_9fa48("399"),
        {
          ok: stryMutAct_9fa48("400") ? true : (stryCov_9fa48("400"), false),
          error,
        });
  }
}
