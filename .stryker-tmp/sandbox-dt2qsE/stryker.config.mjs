// @ts-nocheck
//
/**
 * 变异测试 —— 全局验收标准 ④。
 *
 * 它回答的问题不是「测试覆盖了多少行」，而是
 * IMPORTANT: 「把实现故意改错，测试会不会红」。
 * 100% 行覆盖 + CI 全绿的状态下，把指数退避改成线性退避
 * 而 14 个测试全部通过 —— 那件事就发生在这个项目上。
 *
 * NOTE: 存活的变异体分两类，只有人能分：
 *   真漏测      改了行为、测试没抓到 → 补测试
 *   等价变异    改了代码、行为没变   → 不用管，但要说得出为什么
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  packageManager: "pnpm",
  testRunner: "vitest",
  // TRAP: pnpm 的严格 node_modules 布局让 Stryker 的插件自动发现失效
  //       （Cannot find TestRunner plugin "vitest"）。必须显式列出来。
  plugins: ["@stryker-mutator/vitest-runner"],
  // TRAP: 默认的 worker 线程池不支持 process.chdir()，而 path.ts 有一条
  //       「不读 process.cwd()」的性质测试要用它。forks 池是子进程，可以。
  vitest: { configFile: "vitest.stryker.config.ts" },
  reporters: ["html", "clear-text", "progress"],
  coverageAnalysis: "perTest",

  // src/index.ts 是 composition root，没有逻辑；fake 是测试替身，不是被测对象
  mutate: ["src/**/*.ts", "!src/index.ts", "!src/infra/fake/**"],

  // 时间预算：领域层都是纯函数，超时基本意味着变异体制造了死循环
  timeoutMS: 20000,
  concurrency: 2,
};
