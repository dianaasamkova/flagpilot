import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["**/node_modules/", "**/.next/", "**/coverage/", "**/next-env.d.ts"]),

  // Every TypeScript file in the repo
  js.configs.recommended,
  tseslint.configs.strict,

  // Next.js and React rules, only for the web app
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    extends: [nextVitals],
    settings: { next: { rootDir: "apps/web" } },
  },
]);
