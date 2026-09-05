/**
 * 运行环境的能力探测。
 *
 * @remarks
 * TRAP: `process.chdir()` 在 vitest 的 worker 线程池里会抛
 * `process.chdir() is not supported in workers`。
 * 平时 `pnpm test` 用 forks 池，没事；但 Stryker 的 vitest runner
 * **把 pool: 'threads' 写死在源码里**（vitest-test-runner.js:41），
 * 配置覆盖不了 —— 于是用 chdir 的测试会让 Stryker 的初始试跑直接失败。
 *
 * 用它 skip 掉那几条，代价写在 ADR 0012。
 */
// @ts-nocheck

export const canChdir = ((): boolean => {
  try {
    process.chdir(process.cwd());
    return true;
  } catch {
    return false;
  }
})();
