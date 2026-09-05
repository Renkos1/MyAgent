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
import path from "node:path";
import type { Result } from "./result.ts";
import { err, ok } from "./result.ts";

/**
 * 路径校验失败的原因。
 *
 * @remarks
 * 每个 kind 描述的是失败的**原因**，不是输入的形状 ——
 * 调用方要靠它决定「怎么处理」，不是「怎么描述」。
 */
export type PathError =
  | {
      readonly kind: "empty";
    }
  | {
      readonly kind: "absolute";
    }
  | {
      readonly kind: "escapes-root";
    }
  | {
      readonly kind: "nul-byte";
    };

/**
 * 把模型/用户给的一个路径解析成仓库内的绝对路径；越界一律拒绝。
 *
 * @remarks
 * 纯函数：不 stat、不 readFile、不碰 fs，只做字符串和路径运算。
 * 符号链接、文件存不存在都不归它管（IO 适配器的事）。
 *
 * SAFETY: 这是 CWE-22（路径穿越）的战场。三条实现约束不能动，
 * 见 ADR 0008 的「SAFETY」一节。
 *
 * @param root - 仓库根目录的 POSIX 绝对路径
 * @param candidate - 待校验的路径（仓库相对）
 * @returns 成功时是仓库内的绝对路径；失败时 {@link PathError}
 *          ——  NOTE: 它只带 kind，不带那个路径，因为那个值来自模型/用户
 * @see docs/decisions/0008-path-resolution.md  六个决定的候选、判据、代价
 */
/** NUL 字节。fs 遇到它会抛 ERR_INVALID_ARG_VALUE，在这一层先拒掉。 */
const NUL = stryMutAct_9fa48("357") ? "" : (stryCov_9fa48("357"), "\u0000");
export function resolveInsideRoot(
  root: string,
  candidate: string,
): Result<string, PathError> {
  if (stryMutAct_9fa48("358")) {
    {
    }
  } else {
    stryCov_9fa48("358");
    if (
      stryMutAct_9fa48("361")
        ? candidate !== ""
        : stryMutAct_9fa48("360")
          ? false
          : stryMutAct_9fa48("359")
            ? true
            : (stryCov_9fa48("359", "360", "361"),
              candidate ===
                (stryMutAct_9fa48("362")
                  ? "Stryker was here!"
                  : (stryCov_9fa48("362"), "")))
    )
      return err(
        stryMutAct_9fa48("363")
          ? {}
          : (stryCov_9fa48("363"),
            {
              kind: stryMutAct_9fa48("364")
                ? ""
                : (stryCov_9fa48("364"), "empty"),
            }),
      );
    if (
      stryMutAct_9fa48("366")
        ? false
        : stryMutAct_9fa48("365")
          ? true
          : (stryCov_9fa48("365", "366"), candidate.includes(NUL))
    )
      return err(
        stryMutAct_9fa48("367")
          ? {}
          : (stryCov_9fa48("367"),
            {
              kind: stryMutAct_9fa48("368")
                ? ""
                : (stryCov_9fa48("368"), "nul-byte"),
            }),
      );

    // SAFETY: 反斜杠替换必须在 isAbsolute / resolve 之前，
    //         否则 "..\..\x" 在 POSIX 下会被当成一个含反斜杠的文件名，不是穿越。
    const normalized = candidate.replaceAll(
      stryMutAct_9fa48("369") ? "" : (stryCov_9fa48("369"), "\\"),
      stryMutAct_9fa48("370") ? "" : (stryCov_9fa48("370"), "/"),
    );

    // SAFETY: 绝对路径一律拒绝，且必须在 resolve 之前判断 ——
    //         resolve 遇到绝对路径会丢弃左边所有参数，root 就完全失效了。
    if (
      stryMutAct_9fa48("372")
        ? false
        : stryMutAct_9fa48("371")
          ? true
          : (stryCov_9fa48("371", "372"), path.posix.isAbsolute(normalized))
    )
      return err(
        stryMutAct_9fa48("373")
          ? {}
          : (stryCov_9fa48("373"),
            {
              kind: stryMutAct_9fa48("374")
                ? ""
                : (stryCov_9fa48("374"), "absolute"),
            }),
      );

    // IMPORTANT: 用 path.posix 而不是 path —— 开发在 Windows、运行在 Linux，
    //            path.resolve 在 Windows 上会补盘符（C:\repo\...）。
    //            这条有 ESLint no-restricted-syntax 守着，不只是注释。
    const abs = path.posix.resolve(root, normalized);

    // SAFETY: 不能用 abs.startsWith(root) —— 那是字符串前缀比较，不懂分隔符，
    //         "/repo-evil" 也以 "/repo" 开头（CWE-22）。
    //         正确判据：要走出 root，从 root 出发的第一步必然是 ".."。
    const rel = path.posix.relative(root, abs);
    if (
      stryMutAct_9fa48("377")
        ? rel === ".." && rel.startsWith(`..${path.posix.sep}`)
        : stryMutAct_9fa48("376")
          ? false
          : stryMutAct_9fa48("375")
            ? true
            : (stryCov_9fa48("375", "376", "377"),
              (stryMutAct_9fa48("379")
                ? rel !== ".."
                : stryMutAct_9fa48("378")
                  ? false
                  : (stryCov_9fa48("378", "379"),
                    rel ===
                      (stryMutAct_9fa48("380")
                        ? ""
                        : (stryCov_9fa48("380"), "..")))) ||
                (stryMutAct_9fa48("381")
                  ? rel.endsWith(`..${path.posix.sep}`)
                  : (stryCov_9fa48("381"),
                    rel.startsWith(
                      stryMutAct_9fa48("382")
                        ? ``
                        : (stryCov_9fa48("382"), `..${path.posix.sep}`),
                    ))))
    ) {
      if (stryMutAct_9fa48("383")) {
        {
        }
      } else {
        stryCov_9fa48("383");
        return err(
          stryMutAct_9fa48("384")
            ? {}
            : (stryCov_9fa48("384"),
              {
                kind: stryMutAct_9fa48("385")
                  ? ""
                  : (stryCov_9fa48("385"), "escapes-root"),
              }),
        );
      }
    }

    // 尾斜杠保留（ADR 0008 §③）。resolve 会把它吃掉，这里补回来。
    // NOTE: rel === "" 表示目标就是 root 自己，那时不补（避免 "/repo" → "/repo/"）。
    const keepTrailingSlash = stryMutAct_9fa48("388")
      ? normalized.endsWith("/") || !abs.endsWith("/")
      : stryMutAct_9fa48("387")
        ? false
        : stryMutAct_9fa48("386")
          ? true
          : (stryCov_9fa48("386", "387", "388"),
            (stryMutAct_9fa48("389")
              ? normalized.startsWith("/")
              : (stryCov_9fa48("389"),
                normalized.endsWith(
                  stryMutAct_9fa48("390") ? "" : (stryCov_9fa48("390"), "/"),
                ))) &&
              (stryMutAct_9fa48("391")
                ? abs.endsWith("/")
                : (stryCov_9fa48("391"),
                  !(stryMutAct_9fa48("392")
                    ? abs.startsWith("/")
                    : (stryCov_9fa48("392"),
                      abs.endsWith(
                        stryMutAct_9fa48("393")
                          ? ""
                          : (stryCov_9fa48("393"), "/"),
                      ))))));
    return ok(
      keepTrailingSlash
        ? stryMutAct_9fa48("394")
          ? ``
          : (stryCov_9fa48("394"), `${abs}/`)
        : abs,
    );
  }
}
