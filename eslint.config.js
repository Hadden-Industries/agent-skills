import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";

export default [
  {
    ignores: [
      ".agent-tools/**",
      ".agents/**",
      ".claude/**",
      ".venv/**",
      "node_modules/**",
      "plugins/**",
      "skills/**",
    ],
  },
  eslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: globals.node,
      sourceType: "module",
    },
    rules: {
      curly: "error",
      eqeqeq: ["error", "always"],
      "guard-for-in": "error",
      "no-bitwise": "error",
      "no-caller": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-control-regex": "error",
      "no-empty": "error",
      "no-new": "error",
      "no-prototype-builtins": "error",
      "no-redeclare": "error",
      "no-undef": "error",
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "no-use-before-define": ["error", { functions: false }],
      "no-var": "error",
      "prefer-const": "error",
      semi: ["error", "always"],
    },
  },
  eslintConfigPrettier,
];
