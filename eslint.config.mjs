// @ts-check

import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import jsdoc from "eslint-plugin-jsdoc";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    files: ["**/*.ts"],

    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],

    languageOptions: {
      globals: globals.nodeBuiltin,

      parserOptions: {
        projectService: true,
      },
    },
  },

  {
    // ★导出边界上的 TSDoc★
    //
    // 起因是一次实测：resolveInsideRoot 的 16 行文档块（含 @param ×2 /
    // @returns / @see）写在 const NUL 上面，中间夹了一个声明 ——
    // ★TypeScript 把归属判给了谁都不是，编辑器里悬停显示为空★。
    // tsc / prettier / 测试都不看注释，四道门全绿。见 ts-modern-train 的
    // docs/engineering/21-comment-conventions.md 坑 5。
    //
    // 只管 src/ 的导出：测试文件里的导出是给测试自己用的，不是对外契约。
    files: ["src/**/*.ts"],
    plugins: { jsdoc },
    rules: {
      // 导出的函数 / 类 / 接口 / 类型别名必须有块。
      // NOTE: 判据是「调用方在★别的文件★里悬停它，需不需要一句话」——
      //       所以类型别名也算，光靠同文件上方的共享注释，跨文件是看不见的。
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: true,
          require: { FunctionDeclaration: true, ClassDeclaration: true },
          contexts: ["TSInterfaceDeclaration", "TSTypeAliasDeclaration"],
          enableFixer: false,
        },
      ],

      // 块里必须有正文，不能只堆标签。
      "jsdoc/require-description": ["error", { contexts: ["any"] }],

      // @param 的名字必须和签名对得上。
      // IMPORTANT: 这条补的是 ★TypeScript 自己的洞★ —— 实测：.ts 文件里
      //            给无参函数写 @param x，tsc 一声不吭，而且悬停★照样把 x 显示出来★。
      "jsdoc/check-param-names": "error",

      // 拼错的标签（@returm）当场报错，而不是静默消失。
      "jsdoc/check-tag-names": ["error", { typed: true }],
    },
  },

  {
    // ★领域层：只许 path.posix.*★
    //
    // 这条规则杀的是一个★实测存活的变异体★（见 docs/decisions/0002）：
    // 把 path.posix.resolve 换成 path.resolve，14 个变异体里唯一活下来的一个。
    // 活下来的原因是 Linux 上两者输出完全相同 —— ★测试不可能分辨★：
    //     posix.resolve("/repo","../x") → "/x"
    //     平台 resolve("/repo","../x")  → "/x"     相等 = true
    // 原计划要等阶段 11 的 Windows CI matrix 才能杀它。
    // ★但它是调用形状问题，不是运行时问题★ —— 换个门禁层级就静态可查。
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.name='path'][property.name!='posix']",
          message:
            "领域层只许用 path.posix.*：path.resolve 在 Windows 上会补盘符、" +
            "遇到相对 root 还会读 process.cwd()，那就不是纯函数了。",
        },
      ],
    },
  },

  {
    // TRAP: .stryker-tmp 是 Stryker 复制的整份源码副本。不挡住的话
    //       pnpm lint 会去 lint 那些副本 —— 实测 123 个 error，
    //       而且报的是 tsconfigRootDir 之类看不懂的错。
    ignores: ["dist/**", "coverage/**", ".stryker-tmp/**", "reports/**"],
  },
]);
