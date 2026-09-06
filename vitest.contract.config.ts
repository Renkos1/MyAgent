import { defineConfig } from "vitest/config";

/**
 * 只跑契约套件的配置。给 stryker.contract.config.mjs 用。
 *
 * 为什么要单独一份：变异体打在 Fake 上时，runTurn 的 42 个用例也会红 ——
 * 那些红证明的是「用例测试有鉴别力」，不是「契约套件有鉴别力」。
 * 两种红混在一起，报告就读不出结论了。
 */
export default defineConfig({
  test: {
    include: ["test/contract/**/*.test.ts"],
    restoreMocks: true,
  },
});
