import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Lint source correctness separately from formatting. Existing boundary types
// intentionally contain `any`; typecheck and synthetic contract tests cover them.
export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "android/**",
      "ios/**",
      "coverage/**",
      "dist/**",
      "src/inc/**",
      "**/*.snap",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      "no-undef": "off", // TypeScript resolves platform globals and type names.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off", // Preserve legacy callback signatures; not a safety gate.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off", // Native mocks and compatibility loaders use require.
      // Do not attach private backend errors/URLs as public error causes.
      "preserve-caught-error": "off",
      "@typescript-eslint/no-empty-object-type": [
        "error",
        { allowInterfaces: "always" },
      ],
      "no-console": "error",
      "no-eval": "error",
      "no-new-func": "error",
      "no-implied-eval": "error",
      "no-debugger": "error",
      "no-unsafe-finally": "error",
    },
  },
  {
    files: ["src/helpers/networkSafety.ts", "src/helpers/firebase.ts"],
    rules: { "no-control-regex": "off" },
  }, // These filters deliberately reject control characters.
  { files: ["**/__tests__/**"], rules: { "no-console": "off" } }, // Tests inspect mocked console calls; production logging remains forbidden.
);
