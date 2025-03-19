// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: ".",
      },
    },
    rules: {
      // Custom rules
      "no-unused-vars": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
    },
    ignores: ["**/node_modules/**", "dist/**"],
  }
);