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
    ignores: ["dist/**", "coverage/**"],
  },
]);
