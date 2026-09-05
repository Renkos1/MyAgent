/**
 * 分层门禁 —— ★这是阶段 2 的验收标准，不是事后检查★。
 *
 * 规则只有一条，但它是整个阶段 2 的意义所在：
 *
 *     domain ← app ← infra        箭头 = 「被依赖」，不是「依赖」
 *
 * 里层不许知道外层的存在。★这条一破，阶段 3 就没法用 fake 跑测试★
 * —— 因为用例层会直接把真的 SDK 拖进来。
 *
 * 判据见 ts-modern-train docs/roadmap.md「架构决策清单」第 6 条：
 * 「现在就把 src/ 按 domain / app / infra 分好，转 workspace 那天只是移目录」。
 *
 * ⚠ 这个配置是 .cjs：dependency-cruiser 18 的配置走 require，不吃 ESM。
 */
module.exports = {
  forbidden: [
    {
      name: "domain-无出边",
      comment:
        "领域层只许 import 自己人。★第三方包一律不许★ —— " +
        "领域规则一旦长在别人的 API 上，那个包就换不掉了。",
      severity: "error",
      from: { path: "^src/domain" },
      to: { pathNot: "^src/domain", dependencyTypesNot: ["core"] },
    },
    {
      name: "domain-内置只许纯的",
      comment:
        "★白名单，不是黑名单★：新增的内置模块默认被挡住，不用追着 Node 更新。\n" +
        "判据不是「是不是标准库」，是★能不能做 IO / 读环境★ —— 规则的立论要和风险对齐。\n" +
        "node:path  纯字符串运算（前提：只用 path.posix.*，见 eslint 里的配套规则）\n" +
        "node:url   URL 解析，同样是纯的\n" +
        "要加新的，★在这里写一行理由再加★。",
      severity: "error",
      from: { path: "^src/domain" },
      to: { dependencyTypes: ["core"], pathNot: "^(node:)?(path|url)$" },
    },
    {
      name: "app-不许碰-infra",
      comment:
        "★依赖倒置的全部内容就是这一条。★ 用例层只认自己定义的端口接口，" +
        "不认实现。破了这条，测试就必须连真网络。",
      severity: "error",
      from: { path: "^src/app" },
      to: { path: "^src/infra" },
    },
    {
      name: "无环",
      comment: "循环依赖 = 模块边界画错了。",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "无孤儿",
      comment: "没人 import 也不是入口的文件 —— 多半是忘了删。",
      severity: "warn",
      from: { orphan: true, pathNot: "\\.d\\.ts$" },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: [".ts", ".js"] },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
