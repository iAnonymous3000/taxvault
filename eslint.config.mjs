import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["coverage/**", "web/pkg/**", "web/vendor/**"],
  },
  js.configs.recommended,
  {
    files: ["web/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2024,
      },
    },
  },
  {
    files: ["tests/playwright/**/*.js", "playwright.config.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ["tests/unit/**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
];
