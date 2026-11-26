// The FlagStore contract (FP-11): the same tests run against the in-memory store and the
// Postgres store, so the app behaves the same on both.
//
// The Postgres half needs TEST_DATABASE_URL pointing at a migrated, throwaway database.
// CI starts one in a container; locally it's skipped when the variable isn't set.
import type { FlagEvent, Proposal } from "@flagpilot/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MemoryFlagStore,
  PrismaFlagStore,
  createPrismaClient,
  deleteSandbox,
  ensureSandbox,
  seedEvents,
  seedFlags,
  type FlagStore,
  type PrismaClient,
} from "../src/index.ts";

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];

// checkout-one-page in staging is seeded as: on, EU, 50%, revision 2
const before = { enabled: true, targeting: { regions: ["EU" as const] }, rolloutPercent: 50 };
const after = { ...before, rolloutPercent: 80 };

function pendingProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "p-1",
    flagKey: "checkout-one-page",
    env: "staging",
    reason: "Widen the beta",
    baseRevision: 2,
    before,
    after,
    createdBy: "u-editor",
    createdAt: "2026-11-18T10:00:00.000Z",
    expiresAt: "2026-11-18T10:15:00.000Z",
    status: "pending",
    ...overrides,
  };
}

function confirmEvent(id = "e-new"): Omit<FlagEvent, "revision"> {
  return {
    id,
    flagKey: "checkout-one-page",
    env: "staging",
    actor: "u-editor",
    at: "2026-11-18T10:01:00.000Z",
    reason: "Widen the beta",
    before,
    after,
  };
}

function contractTests(newStore: () => Promise<FlagStore>) {
  it("lists every seeded flag, sorted by key", async () => {
    const store = await newStore();
    const keys = (await store.listFlags()).map((flag) => flag.key);
    expect(keys).toEqual(
      seedFlags()
        .map((flag) => flag.key)
        .sort(),
    );
  });

  it("gets one flag with all three environments, or undefined", async () => {
    const store = await newStore();
    const seeded = seedFlags().find((flag) => flag.key === "checkout-one-page");
    expect(await store.getFlag("checkout-one-page")).toEqual(seeded);
    expect(await store.getFlag("checkout-missing")).toBeUndefined();
  });

  it("lists history newest first, filters by environment and applies the limit", async () => {
    const store = await newStore();
    const all = await store.listEvents("checkout-one-page", { limit: 10 });
    expect(all.map((event) => event.id)).toEqual(["e-2", "e-1"]);
    expect(all[0]).toEqual(seedEvents().find((event) => event.id === "e-2"));

    expect(await store.listEvents("checkout-one-page", { env: "production", limit: 10 })).toEqual(
      [],
    );
    expect(await store.listEvents("checkout-one-page", { limit: 1 })).toHaveLength(1);
  });

  it("saves and reads back a proposal; an unknown id is undefined", async () => {
    const store = await newStore();
    await store.saveProposal(pendingProposal());
    expect(await store.getProposal("p-1")).toEqual(pendingProposal());
    expect(await store.getProposal("p-unknown")).toBeUndefined();
  });

  it("discards only a pending proposal", async () => {
    const store = await newStore();
    await store.saveProposal(pendingProposal());

    expect(await store.discardPendingProposal("p-1")).toBe(true);
    expect((await store.getProposal("p-1"))?.status).toBe("discarded");
    expect(await store.discardPendingProposal("p-1")).toBe(false);
    expect(await store.discardPendingProposal("p-unknown")).toBe(false);
  });

  it("never marks a confirmed proposal discarded", async () => {
    const store = await newStore();
    await store.saveProposal(pendingProposal());
    await store.applyProposal(pendingProposal(), confirmEvent());

    expect(await store.discardPendingProposal("p-1")).toBe(false);
    expect((await store.getProposal("p-1"))?.status).toBe("confirmed");
  });

  it("refuses to apply a proposal that was discarded meanwhile, and writes nothing", async () => {
    const store = await newStore();
    await store.saveProposal(pendingProposal());
    await store.discardPendingProposal("p-1");

    // The caller still holds the pending copy it read before the Discard
    const result = await store.applyProposal(pendingProposal(), confirmEvent());

    expect(result).toEqual({ ok: false, error: "not_pending" });
    expect((await store.getFlag("checkout-one-page"))?.envs.staging.revision).toBe(2);
    expect(await store.listEvents("checkout-one-page", { limit: 10 })).toHaveLength(2);
    expect((await store.getProposal("p-1"))?.status).toBe("discarded");
  });

  it("lets Confirm and Discard of one proposal race, and keeps the result consistent", async () => {
    const store = await newStore();
    await store.saveProposal(pendingProposal());

    const [applied, discarded] = await Promise.all([
      store.applyProposal(pendingProposal(), confirmEvent()),
      store.discardPendingProposal("p-1"),
    ]);

    // Exactly one wins, and the stored status, flag and history all agree with it
    expect(applied.ok).not.toBe(discarded);
    const flag = await store.getFlag("checkout-one-page");
    const history = await store.listEvents("checkout-one-page", { limit: 10 });
    const status = (await store.getProposal("p-1"))?.status;
    if (applied.ok) {
      expect([status, flag?.envs.staging.revision, history.length]).toEqual(["confirmed", 3, 3]);
    } else {
      expect(applied).toEqual({ ok: false, error: "not_pending" });
      expect([status, flag?.envs.staging.revision, history.length]).toEqual(["discarded", 2, 2]);
    }
  });

  it("applies a proposal: new settings, revision + 1, one event, proposal confirmed", async () => {
    const store = await newStore();
    await store.saveProposal(pendingProposal());

    const result = await store.applyProposal(pendingProposal(), confirmEvent());

    expect(result).toEqual({ ok: true, value: { ...confirmEvent(), revision: 3 } });
    const flag = await store.getFlag("checkout-one-page");
    expect(flag?.envs.staging).toEqual({ ...after, revision: 3 });
    expect(flag?.envs.production).toEqual(seedFlags()[0]?.envs.production);
    const history = await store.listEvents("checkout-one-page", { limit: 10 });
    expect(history.map((event) => event.id)).toEqual(["e-new", "e-2", "e-1"]);
    expect((await store.getProposal("p-1"))?.status).toBe("confirmed");
  });

  it("refuses a stale revision and writes nothing", async () => {
    const store = await newStore();
    await store.saveProposal(pendingProposal({ baseRevision: 1 }));

    const result = await store.applyProposal(pendingProposal({ baseRevision: 1 }), confirmEvent());

    expect(result).toEqual({ ok: false, error: "conflict" });
    expect((await store.getFlag("checkout-one-page"))?.envs.staging.revision).toBe(2);
    expect(await store.listEvents("checkout-one-page", { limit: 10 })).toHaveLength(2);
    expect((await store.getProposal("p-1"))?.status).toBe("pending");
  });

  it("lets only one of two simultaneous confirms through (two tabs)", async () => {
    const store = await newStore();
    await store.saveProposal(pendingProposal({ id: "p-a" }));
    await store.saveProposal(pendingProposal({ id: "p-b" }));

    const results = await Promise.all([
      store.applyProposal(pendingProposal({ id: "p-a" }), confirmEvent("e-a")),
      store.applyProposal(pendingProposal({ id: "p-b" }), confirmEvent("e-b")),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "conflict" }]);
    expect((await store.getFlag("checkout-one-page"))?.envs.staging.revision).toBe(3);
    expect(await store.listEvents("checkout-one-page", { limit: 10 })).toHaveLength(3);
  });

  it("applies one proposal only once when it's confirmed twice at the same time", async () => {
    const store = await newStore();
    await store.saveProposal(pendingProposal());

    const results = await Promise.all([
      store.applyProposal(pendingProposal(), confirmEvent("e-a")),
      store.applyProposal(pendingProposal(), confirmEvent("e-b")),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "not_pending" }]);
    expect((await store.getFlag("checkout-one-page"))?.envs.staging.revision).toBe(3);
    expect(await store.listEvents("checkout-one-page", { limit: 10 })).toHaveLength(3);
  });
}

// CI always has a database, so the Postgres tests below can't be skipped there by accident
it.runIf(process.env["CI"])("has TEST_DATABASE_URL in CI", () => {
  expect(TEST_DATABASE_URL).toBeDefined();
});

describe("MemoryFlagStore contract", () => {
  contractTests(async () => new MemoryFlagStore({ flags: seedFlags(), events: seedEvents() }));
});

describe.skipIf(TEST_DATABASE_URL === undefined)("PrismaFlagStore", () => {
  let db: PrismaClient;
  const sandboxes: string[] = [];

  /** A store on a new sandbox; afterAll deletes them all. */
  function newSandboxStore(): PrismaFlagStore {
    const sandboxId = crypto.randomUUID();
    sandboxes.push(sandboxId);
    return new PrismaFlagStore(db, sandboxId);
  }

  beforeAll(() => {
    db = createPrismaClient(TEST_DATABASE_URL as string);
  });
  afterAll(async () => {
    for (const id of sandboxes) await deleteSandbox(db, id);
    await db.$disconnect();
  });

  describe("contract", () => {
    contractTests(async () => newSandboxStore());
  });

  it("keeps sandboxes apart: a change in one isn't visible in another", async () => {
    const mine = newSandboxStore();
    const theirs = newSandboxStore();
    await mine.saveProposal(pendingProposal());
    await mine.applyProposal(pendingProposal(), confirmEvent());

    expect((await mine.getFlag("checkout-one-page"))?.envs.staging.revision).toBe(3);
    expect((await theirs.getFlag("checkout-one-page"))?.envs.staging.revision).toBe(2);
    expect(await theirs.getProposal("p-1")).toBeUndefined();
  });

  it("seeds a sandbox once, even when two requests ask at the same time", async () => {
    const sandboxId = crypto.randomUUID();
    sandboxes.push(sandboxId);

    const created = await Promise.all([ensureSandbox(db, sandboxId), ensureSandbox(db, sandboxId)]);

    expect(created.sort()).toEqual([false, true]);
    expect(await db.flag.count({ where: { sandboxId } })).toBe(seedFlags().length);
  });

  it("deletes everything in a sandbox when the sandbox is deleted", async () => {
    const store = newSandboxStore();
    await store.saveProposal(pendingProposal());

    await deleteSandbox(db, store.sandboxId);

    const where = { where: { sandboxId: store.sandboxId } };
    const counts = await Promise.all([
      db.flag.count(where),
      db.envConfig.count(where),
      db.flagEvent.count(where),
      db.proposal.count(where),
    ]);
    expect(counts).toEqual([0, 0, 0, 0]);
  });

  it("rejects an UPDATE on the history: events are append-only", async () => {
    const store = newSandboxStore();
    await store.listFlags();

    await expect(
      db.flagEvent.updateMany({
        where: { sandboxId: store.sandboxId },
        data: { reason: "rewritten" },
      }),
    ).rejects.toThrow(/append-only/);
  });

  it("rejects a rollout above 100 in the database itself", async () => {
    const store = newSandboxStore();
    await store.listFlags();

    await expect(
      db.envConfig.updateMany({
        where: { sandboxId: store.sandboxId, flagKey: "checkout-one-page" },
        data: { rolloutPercent: 101 },
      }),
    ).rejects.toThrow(/rolloutPercent_check/);
  });

  it("fails with a readable message when a JSON column holds the wrong shape", async () => {
    const store = newSandboxStore();
    await store.listFlags();
    // An empty region list breaks the Targeting rule
    await db.envConfig.updateMany({
      where: { sandboxId: store.sandboxId, flagKey: "checkout-one-page", env: "dev" },
      data: { targeting: { regions: [] } },
    });

    await expect(store.getFlag("checkout-one-page")).rejects.toThrow(
      /Invalid flag "checkout-one-page" in the database/,
    );
  });
});
