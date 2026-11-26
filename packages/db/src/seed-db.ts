// `pnpm db:seed`: resets the shared sandbox to the Bramble Market seed data.
// Visitor sandboxes don't need this: each one is seeded on its first request.
import {
  SHARED_SANDBOX_ID,
  createPrismaClient,
  deleteSandbox,
  ensureSandbox,
} from "./prisma-store.ts";

const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("DATABASE_URL isn't set. Put it in the repo-root .env (see .env.example).");
  process.exit(1);
}

const db = createPrismaClient(url);
try {
  await deleteSandbox(db, SHARED_SANDBOX_ID);
  await ensureSandbox(db, SHARED_SANDBOX_ID);
  const flags = await db.flag.count({ where: { sandboxId: SHARED_SANDBOX_ID } });
  console.log(`Seeded the shared sandbox ${SHARED_SANDBOX_ID} with ${flags} flags.`);
} finally {
  await db.$disconnect();
}
