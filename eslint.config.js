import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["**/dist", "**/node_modules", "docs/**", "**/*.d.ts"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["node:*", "fs", "path", "crypto", "os", "child_process"] },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["**/*.{mjs,js}"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...globals.node } },
  },
]);
