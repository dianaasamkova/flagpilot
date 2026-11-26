// Prisma CLI settings (migrate, generate, seed). The app itself never reads this file:
// it passes DATABASE_URL to the client at runtime (src/prisma-store.ts).
import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Local development keeps DATABASE_URL in the repo-root .env (never committed).
// CI and Vercel set it as a real environment variable instead.
const envFile = new URL("../../.env", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node src/seed-db.ts",
  },
  datasource: {
    // Empty is fine for `prisma generate`; migrate and seed fail with a clear message
    url: process.env["DATABASE_URL"] ?? "",
  },
});
