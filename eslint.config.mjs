// @ts-check

import js from "@eslint/js";
import { defineConfig } from "eslint/config";
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
    ignores: ["dist/**", "coverage/**"],
  },
]);
