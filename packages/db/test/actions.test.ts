import type { FlagChange, User } from "@flagpilot/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEMO_USERS,
  MemoryFlagStore,
  confirmProposal,
  discardProposal,
  proposeChange,
  seedEvents,
  seedFlags,
  type Deps,
} from "../src/index.ts";

const [viewer, editor, admin] = DEMO_USERS as [User, User, User];

// A fixed clock and predictable ids
let clock: Date;
let counter: number;
const deps: Deps = { now: () => clock, newId: () => `id-${++counter}` };

let store: MemoryFlagStore;
beforeEach(() => {
  clock = new Date("2026-11-18T10:00:00.000Z");
  counter = 0;
  store = new MemoryFlagStore({ flags: seedFlags(), events: seedEvents() });
});

const widen: FlagChange = {
  flagKey: "checkout-one-page",
  env: "staging",
  set: { rolloutPercent: 80 },
  reason: "Widen the beta",
};

async function propose(user: User = editor, change: FlagChange = widen) {
  const result = await proposeChange(store, user, change, deps);
  if (!result.ok) throw new Error(`setup: ${result.error.message}`);
  return result.value.proposal;
}

describe("proposeChange", () => {
  it("stores a pending proposal and leaves the flag unchanged", async () => {
    const proposal = await propose();
    expect(await store.getProposal(proposal.id)).toMatchObject({ status: "pending" });
    expect((await store.getFlag("checkout-one-page"))?.envs.staging.rolloutPercent).toBe(50);
  });

  it("refuses an unknown flag and points the model to list_flags", async () => {
    const result = await proposeChange(store, editor, { ...widen, flagKey: "checkout-nope" }, deps);
    expect(!result.ok && result.error.message).toContain("list_flags");
  });

  it("refuses a viewer and stores nothing", async () => {
    const result = await proposeChange(store, viewer, widen, deps);
    expect(!result.ok && result.error.code).toBe("forbidden");
    expect(await store.getProposal("id-1")).toBeUndefined();
  });
});

describe("confirmProposal", () => {
  it("applies the change, bumps the revision and appends a history event", async () => {
    const proposal = await propose();
    const result = await confirmProposal(store, editor, proposal.id, deps);

    expect(result.ok).toBe(true);
    const flag = await store.getFlag("checkout-one-page");
    expect(flag?.envs.staging).toEqual({
      enabled: true,
      targeting: { regions: ["EU"] },
      rolloutPercent: 80,
      revision: 3,
    });
    const [latest] = await store.listEvents("checkout-one-page", { env: "staging", limit: 1 });
    expect(latest).toMatchObject({ actor: "u-editor", reason: "Widen the beta", revision: 3 });
    expect((await store.getProposal(proposal.id))?.status).toBe("confirmed");
  });

  it("returns not_found for an unknown proposal", async () => {
    expect(await confirmProposal(store, editor, "nope", deps)).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("refuses someone other than the creator", async () => {
    const proposal = await propose();
    expect(await confirmProposal(store, admin, proposal.id, deps)).toEqual({
      ok: false,
      error: "not_creator",
    });
  });

  it("refuses a second confirm of the same proposal", async () => {
    const proposal = await propose();
    await confirmProposal(store, editor, proposal.id, deps);
    expect(await confirmProposal(store, editor, proposal.id, deps)).toEqual({
      ok: false,
      error: "not_pending",
    });
  });

  it("refuses an expired proposal and leaves the flag unchanged", async () => {
    const proposal = await propose();
    clock = new Date("2026-11-18T10:15:00.000Z");
    expect(await confirmProposal(store, editor, proposal.id, deps)).toEqual({
      ok: false,
      error: "expired",
    });
    expect((await store.getFlag("checkout-one-page"))?.envs.staging.revision).toBe(2);
  });

  it("returns conflict when another change landed first (two tabs)", async () => {
    const first = await propose();
    const second = await propose(editor, { ...widen, set: { rolloutPercent: 90 } });
    expect((await confirmProposal(store, editor, first.id, deps)).ok).toBe(true);
    expect(await confirmProposal(store, editor, second.id, deps)).toEqual({
      ok: false,
      error: "conflict",
    });
    expect((await store.getFlag("checkout-one-page"))?.envs.staging.rolloutPercent).toBe(80);
  });

  it("store.applyProposal refuses a stale revision even if called directly", async () => {
    const proposal = await propose();
    const result = await store.applyProposal(
      { ...proposal, baseRevision: 1 },
      {
        id: "e-x",
        flagKey: proposal.flagKey,
        env: proposal.env,
        actor: editor.id,
        at: clock.toISOString(),
        reason: "x",
        before: proposal.before,
        after: proposal.after,
      },
    );
    expect(result).toEqual({ ok: false, error: "conflict" });
  });
});

describe("discardProposal", () => {
  it("marks the proposal discarded, so it can't be confirmed", async () => {
    const proposal = await propose();
    expect((await discardProposal(store, editor, proposal.id)).ok).toBe(true);
    expect(await confirmProposal(store, editor, proposal.id, deps)).toEqual({
      ok: false,
      error: "not_pending",
    });
  });

  it("only lets the creator discard", async () => {
    const proposal = await propose();
    expect(await discardProposal(store, admin, proposal.id)).toEqual({
      ok: false,
      error: "not_creator",
    });
  });
});

describe("MemoryFlagStore", () => {
  it("returns copies, so changing a result doesn't change the store", async () => {
    const flag = await store.getFlag("checkout-one-page");
    if (flag) flag.envs.staging.rolloutPercent = 99;
    expect((await store.getFlag("checkout-one-page"))?.envs.staging.rolloutPercent).toBe(50);
  });

  it("lists history newest first and filters by environment", async () => {
    const events = await store.listEvents("checkout-one-page", { limit: 10 });
    expect(events.map((event) => event.id)).toEqual(["e-2", "e-1"]);
    expect(await store.listEvents("checkout-one-page", { env: "production", limit: 10 })).toEqual(
      [],
    );
  });
});
