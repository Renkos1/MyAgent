// @ts-nocheck
import { defineConfig, mergeConfig } from "vitest/config";

import base from "./vitest.config.ts";

/**
 * Stryker 专用的 vitest 配置。
 *
 * @remarks
 * TRAP: Stryker 的 vitest runner 默认把测试放进 worker 线程跑，
 * 而 `process.chdir()` 在 worker 里不支持 —— path.ts 那条
 * 「不读 process.cwd()」的性质测试会在初始试跑就挂掉，
 * 报错是 `process.chdir() is not supported in workers`，
 * 看起来像测试坏了，其实是 runner 的进程模型变了。
 *
 * forks 池用的是子进程，chdir 可用。
 */
export default mergeConfig(base, defineConfig({ test: { pool: "forks" } }));
