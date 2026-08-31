import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],

    // vi.fn / vi.spyOn 在每个测试后自动还原（假定时器仍需手动 useRealTimers）
    restoreMocks: true,

    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/index.ts"],

      // skipFull 必须写在 reporter 选项里，写在 coverage 顶层不生效
      reporter: [["text", { skipFull: false }], "html", "lcov"],
    },
  },
});
