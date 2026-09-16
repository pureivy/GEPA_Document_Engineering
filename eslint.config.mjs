import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // e2e dev server output and Playwright artifacts
    ".next-e2e/**", ".next-video/**",
    ".e2e-data/**",
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
