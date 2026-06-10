import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // fake-bins are executable CommonJS subprocess fixtures, not lib code.
  { ignores: ["dist/", "test/executors/fake-bins/"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
