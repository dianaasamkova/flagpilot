import { describe, expect, it } from "vitest";
import {
  CONFIRM_ERRORS,
  PROPOSAL_TTL_MINUTES,
  Proposal,
  buildProposal,
  checkConfirm,
  type EnvConfig,
  type FlagChange,
  type User,
} from "../src/index.ts";

const editor: User = { id: "u-editor", name: "Erin", role: "editor" };
const viewer: User = { id: "u-viewer", name: "Vic", role: "viewer" };
const now = new Date("2026-11-18T10:00:00.000Z");

const current: EnvConfig = {
  enabled: true,
  targeting: { regions: ["EU"] },
  rolloutPercent: 10,
  revision: 4,
};

const change: FlagChange = {
  flagKey: "checkout-one-page",
  env: "staging",
  set: { rolloutPercent: 50 },
  reason: "Widen the beta",
};

const build = (overrides: Partial<Parameters<typeof buildProposal>[0]> = {}) =>
  buildProposal({ id: "p-1", user: editor, change, current, now, ...overrides });

describe("buildProposal", () => {
  it("builds a pending proposal with before, after, base revision and expiry", () => {
    const result = build();
    expect(result).toEqual({
      ok: true,
      value: {
        changes: [{ field: "rolloutPercent", before: 10, after: 50 }],
        proposal: {
          id: "p-1",
          flagKey: "checkout-one-page",
          env: "staging",
          reason: "Widen the beta",
          baseRevision: 4,
          before: { enabled: true, targeting: { regions: ["EU"] }, rolloutPercent: 10 },
          after: { enabled: true, targeting: { regions: ["EU"] }, rolloutPercent: 50 },
          createdBy: "u-editor",
          createdAt: "2026-11-18T10:00:00.000Z",
          expiresAt: "2026-11-18T10:15:00.000Z",
          status: "pending",
        },
      },
    });
    expect(PROPOSAL_TTL_MINUTES).toBe(15);
  });

  it("produces a proposal that passes the Proposal schema", () => {
    const result = build();
    expect(result.ok && Proposal.safeParse(result.value.proposal).success).toBe(true);
  });

  it("refuses a user who can't write to the environment", () => {
    const result = build({ user: viewer });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("forbidden");
    expect(!result.ok && result.error.message).toContain("Editors can change dev and staging");
  });

  it("refuses an editor in production", () => {
    const result = build({ change: { ...change, env: "production" } });
    expect(!result.ok && result.error.code).toBe("forbidden");
  });

  it("refuses a rollout above 0 on a flag that stays off", () => {
    const result = build({ current: { ...current, enabled: false } });
    expect(!result.ok && result.error.code).toBe("rollout_needs_enabled");
  });

  it("allows a rollout when the same change turns the flag on", () => {
    const result = build({
      current: { ...current, enabled: false },
      change: { ...change, set: { enabled: true, rolloutPercent: 50 } },
    });
    expect(result.ok).toBe(true);
  });

  it("allows turning off a flag that has a rollout", () => {
    expect(build({ change: { ...change, set: { enabled: false } } }).ok).toBe(true);
  });

  it("refuses a change that changes nothing", () => {
    const result = build({ change: { ...change, set: { rolloutPercent: 10 } } });
    expect(!result.ok && result.error.code).toBe("no_change");
  });
});

describe("checkConfirm", () => {
  const built = build();
  if (!built.ok) throw new Error("setup: proposal should build");
  const proposal = built.value.proposal;
  const check = (overrides: Partial<Parameters<typeof checkConfirm>[0]> = {}) =>
    checkConfirm({ proposal, user: editor, currentRevision: 4, now, ...overrides });

  it("passes for the creator, in time, with the same revision", () => {
    expect(check()).toBeNull();
  });

  it("fails for someone else, even an admin", () => {
    expect(check({ user: { id: "u-admin", name: "Ada", role: "admin" } })).toBe("not_creator");
  });

  it("fails when the creator lost write access since proposing", () => {
    expect(check({ user: { ...editor, role: "viewer" } })).toBe("forbidden");
  });

  it.each(["confirmed", "discarded"] as const)("fails when the proposal is %s", (status) => {
    expect(check({ proposal: { ...proposal, status } })).toBe("not_pending");
  });

  it("passes one millisecond before expiry and fails at expiry", () => {
    const expiry = Date.parse(proposal.expiresAt);
    expect(check({ now: new Date(expiry - 1) })).toBeNull();
    expect(check({ now: new Date(expiry) })).toBe("expired");
  });

  it("fails when the flag changed after the proposal", () => {
    expect(check({ currentRevision: 5 })).toBe("conflict");
  });

  it("maps a conflict to HTTP 409, as ADR-0002 says", () => {
    expect(CONFIRM_ERRORS.conflict.status).toBe(409);
  });
});
