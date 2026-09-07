/**
 * 脚本这一侧的组合根：读环境，读不出来就打印全部问题并退出。
 *
 * @remarks
 * 阶段 4 的六个脚本各自抄了一份 6 行的 `env()`，外加一句「缺 X / Y」的检查 ——
 * 六份完全一样的代码。阶段 5 把 parse 收进 `src/infra/env.ts` 之后，
 * 这里只剩「读不出来该怎么办」这一个决定，而那正是边界层该管的事（决定 D3）。
 *
 * IMPORTANT: `readEnv` 返回 `Result` 是因为它说不出「该怎么办」；
 * 这个函数敢 `process.exit` 是因为它知道自己在一个脚本里。
 * 两者不能合并 —— 合并之后 `readEnv` 就没法在测试里用了。
 */
import type { AppEnv } from "../src/infra/env.ts";
import { readEnv } from "../src/infra/env.ts";

/**
 * 读环境，失败就退出。
 *
 * @param who - 脚本名，只用来让报错说清是谁在要这些变量
 * @returns 校验过的环境
 */
export function loadEnvOrExit(who: string): AppEnv {
  const env = readEnv(process.env);
  if (env.ok) return env.value;

  console.error(`${who} 起不来：环境变量不对。全部问题如下 ——\n`);
  for (const i of env.error) console.error(`  ${i.name}\n      ${i.why}\n`);
  console.error("照着 .env.example 复制一份 .env 再填。");
  process.exit(1);
}
