// @ts-check
/**
 * 契约套件的变异测试 —— 回答「契约套件本身有没有鉴别力」。
 *
 * IMPORTANT: 被测对象是 src/infra/fake/**，和主配置正好相反。
 * 主配置把 fake 排除在外，理由写着「fake 是测试替身，不是被测对象」——
 * 那句话在契约套件建立之前成立，之后不成立了：
 * 契约的被测对象就是「端口的每一个实现」，而 Fake 是第一个实现。
 *
 * 存活的变异体 = 契约套件抓不住的偏差。
 * NOTE: 真适配器在同一处出错时，同样不会红 —— 这才是这份报告的意义。
 *
 * 跑：pnpm mutate:contract
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  packageManager: "pnpm",
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  reporters: ["html", "json", "clear-text", "progress"],
  coverageAnalysis: "perTest",

  mutate: ["src/infra/fake/**/*.ts"],

  // 只跑契约套件。理由见 vitest.contract.config.ts 的头注释。
  vitest: { configFile: "vitest.contract.config.ts" },

  timeoutMS: 20000,
  concurrency: 2,
  htmlReporter: { fileName: "reports/mutation/contract.html" },
  jsonReporter: { fileName: "reports/mutation/contract.json" },
};
