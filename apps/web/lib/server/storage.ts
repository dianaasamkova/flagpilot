// Picks where a sandbox's data lives, on the server only (FP-10).
// - DATABASE_URL set: Postgres through Prisma, so data survives restarts and is shared by
//   every server instance (Vercel runs many).
// - not set: in memory, so the app runs locally and in tests with no database.
import {
  MemoryFlagStore,
  PrismaFlagStore,
  createPrismaClient,
  seedEvents,
  seedFlags,
  type FlagStore,
  type PrismaClient,
} from "@flagpilot/db";

// One client per server process. Kept on globalThis so hot reloads in development don't
// open a new connection pool each time.
const cache = globalThis as { flagpilotPrisma?: PrismaClient };

function prismaClient(url: string): PrismaClient {
  return (cache.flagpilotPrisma ??= createPrismaClient(url));
}

/** A seeded copy of the demo data that lives only in this process. */
export function memoryStore(): FlagStore {
  return new MemoryFlagStore({ flags: seedFlags(), events: seedEvents() });
}

/** The store for one visitor's sandbox. */
export function sandboxStore(sandboxId: string, url = process.env["DATABASE_URL"]): FlagStore {
  return url ? new PrismaFlagStore(prismaClient(url), sandboxId) : memoryStore();
}
