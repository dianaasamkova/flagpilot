// The Postgres FlagStore (FP-10, FP-11), through Prisma. It keeps the same contract as
// MemoryFlagStore, and the same contract tests run against both (test/store-contract.ts).
//
// Two rules for every method:
// - every query filters by this store's sandboxId, so one visitor never sees another's data;
// - every row read back is parsed with the zod schemas from packages/domain, so the JSON
//   columns can't smuggle a wrong shape into the app or the model.
import { PrismaPg } from "@prisma/adapter-pg";
import {
  ENVIRONMENTS,
  Flag,
  FlagEvent,
  Proposal,
  err,
  ok,
  type Environment,
  type Result,
} from "@flagpilot/domain";
import { z } from "zod";
import { PrismaClient, type Prisma } from "./generated/prisma/client.ts";
import { seedEvents, seedFlags } from "./seed.ts";
import type { FlagStore } from "./store.ts";

export { PrismaClient };

/** The data a new sandbox starts with. */
export type SeedData = { flags: readonly Flag[]; events?: readonly FlagEvent[] };
const defaultSeed = (): SeedData => ({ flags: seedFlags(), events: seedEvents() });

/**
 * A fixed sandbox for tools that have no visitor cookie: `pnpm db:seed` resets it, and the
 * MCP server (M7) reads it.
 */
export const SHARED_SANDBOX_ID = "00000000-0000-4000-8000-000000000001";

/** One client per process: it holds a pool of database connections. */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/**
 * Creates a sandbox with its seed data, if it doesn't exist yet. Returns true when it was
 * created by this call. Safe to call twice at once: the second insert waits for the
 * first transaction, finds the row and does nothing.
 */
export async function ensureSandbox(
  db: PrismaClient,
  sandboxId: string,
  seed: SeedData = defaultSeed(),
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    // INSERT ... ON CONFLICT DO NOTHING: count is 0 when the sandbox already exists
    const { count } = await tx.sandbox.createMany({
      data: [{ id: sandboxId }],
      skipDuplicates: true,
    });
    if (count === 0) return false;

    await tx.flag.createMany({
      data: seed.flags.map((flag) => ({
        sandboxId,
        key: flag.key,
        description: flag.description,
        owner: flag.owner,
        tags: flag.tags,
      })),
    });
    await tx.envConfig.createMany({
      data: seed.flags.flatMap((flag) =>
        ENVIRONMENTS.map((env) => ({ sandboxId, flagKey: flag.key, env, ...flag.envs[env] })),
      ),
    });
    await tx.flagEvent.createMany({
      data: (seed.events ?? []).map((event) => eventRow(sandboxId, event)),
    });
    return true;
  });
}

/** Deletes a sandbox and, through ON DELETE CASCADE, every row in it. */
export async function deleteSandbox(db: PrismaClient, sandboxId: string): Promise<void> {
  await db.sandbox.deleteMany({ where: { id: sandboxId } });
}

export class PrismaFlagStore implements FlagStore {
  readonly sandboxId: string;
  private readonly db: PrismaClient;
  private readonly seed: () => SeedData;
  private seeded: Promise<unknown> | undefined;

  /**
   * The sandbox is created and seeded on first use, like a MemoryFlagStore is seeded
   * when it's built, so a store always starts with data.
   */
  constructor(db: PrismaClient, sandboxId: string, seed: () => SeedData = defaultSeed) {
    this.db = db;
    this.sandboxId = sandboxId;
    this.seed = seed;
  }

  async listFlags(): Promise<Flag[]> {
    await this.ready();
    const rows = await this.db.flag.findMany({
      where: { sandboxId: this.sandboxId },
      include: { envs: true },
      orderBy: { key: "asc" },
    });
    return rows.map(toFlag);
  }

  async getFlag(key: string): Promise<Flag | undefined> {
    await this.ready();
    const row = await this.db.flag.findUnique({
      where: { sandboxId_key: { sandboxId: this.sandboxId, key } },
      include: { envs: true },
    });
    return row === null ? undefined : toFlag(row);
  }

  async listEvents(
    key: string,
    options: { env?: Environment | undefined; limit: number },
  ): Promise<FlagEvent[]> {
    await this.ready();
    const rows = await this.db.flagEvent.findMany({
      where: {
        sandboxId: this.sandboxId,
        flagKey: key,
        ...(options.env === undefined ? {} : { env: options.env }),
      },
      // id breaks ties between events with the same timestamp, so the order is stable
      orderBy: [{ at: "desc" }, { id: "desc" }],
      take: options.limit,
    });
    return rows.map(toEvent);
  }

  async saveProposal(proposal: Proposal): Promise<void> {
    await this.ready();
    await this.db.proposal.create({ data: proposalRow(this.sandboxId, proposal) });
  }

  async getProposal(id: string): Promise<Proposal | undefined> {
    await this.ready();
    const row = await this.db.proposal.findUnique({
      where: { sandboxId_id: { sandboxId: this.sandboxId, id } },
    });
    return row === null ? undefined : toProposal(row);
  }

  async discardPendingProposal(id: string): Promise<boolean> {
    await this.ready();
    // Only a pending row matches. If a Confirm holds the row, Postgres makes this wait for
    // it, then re-reads the status, so a confirmed proposal is never marked discarded.
    const { count } = await this.db.proposal.updateMany({
      where: { sandboxId: this.sandboxId, id, status: "pending" },
      data: { status: "discarded" },
    });
    return count === 1;
  }

  async applyProposal(
    proposal: Proposal,
    event: Omit<FlagEvent, "revision">,
  ): Promise<Result<FlagEvent, "conflict" | "not_pending">> {
    await this.ready();
    const { sandboxId } = this;
    try {
      return await this.db.$transaction(async (tx): Promise<Result<FlagEvent, "not_pending">> => {
        // 1. Claim the proposal: only a pending one moves to confirmed. Postgres locks the
        //    row, so a Discard or a second Confirm of it waits, then matches nothing.
        const claimed = await tx.proposal.updateMany({
          where: { sandboxId, id: proposal.id, status: "pending" },
          data: { status: "confirmed" },
        });
        if (claimed.count === 0) return err("not_pending");

        // 2–3. The revision check and the write are one UPDATE. Postgres locks the row,
        //      so if another confirm got there first, this UPDATE sees the new revision
        //      and matches no row. Throwing rolls back step 1 too.
        const { count } = await tx.envConfig.updateMany({
          where: {
            sandboxId,
            flagKey: proposal.flagKey,
            env: proposal.env,
            revision: proposal.baseRevision,
          },
          data: { ...proposal.after, revision: { increment: 1 } },
        });
        if (count === 0) throw new RevisionMoved();

        // 4. The history event, inside the same transaction
        const saved: FlagEvent = { ...event, revision: proposal.baseRevision + 1 };
        await tx.flagEvent.create({ data: eventRow(sandboxId, saved) });
        return ok(saved);
      });
    } catch (error) {
      if (error instanceof RevisionMoved) return err("conflict");
      throw error;
    }
  }

  /** Seeds the sandbox once. A failure isn't remembered, so the next call tries again. */
  private ready(): Promise<unknown> {
    this.seeded ??= ensureSandbox(this.db, this.sandboxId, this.seed()).catch((error: unknown) => {
      this.seeded = undefined;
      throw error;
    });
    return this.seeded;
  }
}

/** Thrown inside applyProposal's transaction to roll it back when the revision moved on. */
class RevisionMoved extends Error {}

// Rows → domain objects. safeParse instead of parse, so the error names the table and
// row, and reads like the messages the rest of the app produces.

function parseRow<T>(schema: z.ZodType<T>, value: unknown, row: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid ${row} in the database:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

type FlagRow = Prisma.FlagGetPayload<{ include: { envs: true } }>;
type EventRow = Prisma.FlagEventGetPayload<object>;
type ProposalRow = Prisma.ProposalGetPayload<object>;

function toFlag(row: FlagRow): Flag {
  const envs = Object.fromEntries(
    row.envs.map((config) => [
      config.env,
      {
        enabled: config.enabled,
        targeting: config.targeting,
        rolloutPercent: config.rolloutPercent,
        revision: config.revision,
      },
    ]),
  );
  return parseRow(
    Flag,
    { key: row.key, description: row.description, owner: row.owner, tags: row.tags, envs },
    `flag "${row.key}"`,
  );
}

function toEvent(row: EventRow): FlagEvent {
  return parseRow(
    FlagEvent,
    {
      id: row.id,
      flagKey: row.flagKey,
      env: row.env,
      actor: row.actor,
      at: row.at.toISOString(),
      reason: row.reason,
      before: row.before,
      after: row.after,
      revision: row.revision,
    },
    `event "${row.id}"`,
  );
}

function toProposal(row: ProposalRow): Proposal {
  return parseRow(
    Proposal,
    {
      id: row.id,
      flagKey: row.flagKey,
      env: row.env,
      reason: row.reason,
      baseRevision: row.baseRevision,
      before: row.before,
      after: row.after,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      status: row.status,
    },
    `proposal "${row.id}"`,
  );
}

// Domain objects → rows. These values were validated when they were made, so they're
// written as they are.

function eventRow(sandboxId: string, event: FlagEvent): Prisma.FlagEventCreateManyInput {
  return {
    sandboxId,
    id: event.id,
    flagKey: event.flagKey,
    env: event.env,
    actor: event.actor,
    at: new Date(event.at),
    reason: event.reason,
    before: event.before,
    after: event.after,
    revision: event.revision,
  };
}

function proposalRow(sandboxId: string, proposal: Proposal): Prisma.ProposalCreateInput {
  return {
    sandbox: { connect: { id: sandboxId } },
    id: proposal.id,
    flagKey: proposal.flagKey,
    env: proposal.env,
    reason: proposal.reason,
    baseRevision: proposal.baseRevision,
    before: proposal.before,
    after: proposal.after,
    createdBy: proposal.createdBy,
    createdAt: new Date(proposal.createdAt),
    expiresAt: new Date(proposal.expiresAt),
    status: proposal.status,
  };
}
