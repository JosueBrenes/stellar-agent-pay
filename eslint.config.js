import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },

  js.configs.recommended,

  // Type aware linting, TypeScript sources only.
  {
    files: ["**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // The CLI reads untyped JSON bodies and SDK error shapes on purpose.
      "@typescript-eslint/no-non-null-assertion": "off",
      // Several SDK hook signatures require a Promise return even when the body
      // is synchronous, so an async function without an await is legitimate here.
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
      eqeqeq: ["error", "smart"],
    },
  },

  // Tests lean on fixture casts, and node:test's test() returns a promise that
  // the runner owns, so awaiting each call would be wrong.
  {
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-floating-promises": "off",
    },
  },

  // Examples, scripts and config are plain JS and are not type checked.
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
      },
    },
  },
);
