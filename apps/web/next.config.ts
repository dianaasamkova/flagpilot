import { existsSync } from "node:fs";
import type { NextConfig } from "next";

// Local development keeps settings in the repo-root .env (see .env.example), shared with
// the Prisma CLI. Vercel sets real environment variables instead.
const rootEnv = new URL("../../.env", import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, so Next.js compiles them.
  transpilePackages: ["@flagpilot/domain", "@flagpilot/db", "@flagpilot/model"],
};

export default nextConfig;
