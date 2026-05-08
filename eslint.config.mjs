import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["src/**/*.ts", "ai_generators-ts/**/*.ts"],
    ignores: ["src/frontend/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
      parserOptions: {
        project: "./tsconfig.ai-generators.json",
        tsconfigRootDir: process.cwd(),
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["src/frontend/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        project: "./tsconfig.frontend.json",
        tsconfigRootDir: process.cwd(),
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["src/server.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-empty": "off",
      "no-useless-escape": "off",
      "prefer-const": "off",
    },
  },
  {
    files: [
      "ai_generators-ts/question_generator.ts",
      "ai_generators-ts/test_new_model.ts",
      "ai_generators-ts/test_nv.ts",
      "ai_generators-ts/visual_generate_explanation.ts",
    ],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
);
