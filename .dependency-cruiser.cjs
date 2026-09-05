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
        "领域层是纯的：只许 import 自己人。★包括不许 import node: 内置模块★ —— " +
        "一旦 import 了 node:fs，它就不再是「拿数据当输入的纯函数」了。",
      severity: "error",
      from: { path: "^src/domain" },
      to: { pathNot: "^src/domain" },
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
