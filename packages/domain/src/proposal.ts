// Propose → confirm (ADR-0002). A proposal is a stored change that hasn't been applied.
// These functions hold the rules; the store (packages/db) only loads and saves.
import { z } from "zod";
import { applyChange, diff, settingsOf, type FieldDiff } from "./diff.ts";
import type { FlagChange } from "./flag-change.ts";
import { EnvSettings, Environment, FlagKey, type EnvConfig } from "./flag.ts";
import { canWrite, type User } from "./permissions.ts";
import { err, ok, type Result } from "./result.ts";

/** How long a proposal can be confirmed. After that, the user asks again. */
export const PROPOSAL_TTL_MINUTES = 15;

export const ProposalStatus = z.enum(["pending", "confirmed", "discarded"]);
export type ProposalStatus = z.infer<typeof ProposalStatus>;

export const Proposal = z.strictObject({
  id: z.string().min(1),
  flagKey: FlagKey,
  env: Environment,
  reason: z.string(),
  // The flag's revision when the proposal was made. Confirm fails if it moved on.
  baseRevision: z.int().min(0),
  before: EnvSettings,
  after: EnvSettings,
  createdBy: z.string().min(1),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  // "Expired" isn't stored: it's worked out from expiresAt when someone confirms
  status: ProposalStatus,
});
export type Proposal = z.infer<typeof Proposal>;

export type ProposeErrorCode = "forbidden" | "rollout_needs_enabled" | "no_change";
export type ProposeError = { code: ProposeErrorCode; message: string };

/** The message for a user who may not change this environment. */
function forbiddenMessage(user: User, env: Environment): string {
  return `As ${user.role}, ${user.name} can't change ${env}. Editors can change dev and staging; admins can change every environment.`;
}

/**
 * Builds a pending proposal, or says why the change can't be proposed (FP-23).
 * It never changes the flag. `current` is the flag's config in `change.env` right now.
 */
export function buildProposal(input: {
  id: string;
  user: User;
  change: FlagChange;
  current: EnvConfig;
  now: Date;
}): Result<{ proposal: Proposal; changes: FieldDiff[] }, ProposeError> {
  const { id, user, change, current, now } = input;

  // 1. Permission, checked early so the user hears "no" before a card appears
  if (!canWrite(user, change.env)) {
    return err({ code: "forbidden", message: forbiddenMessage(user, change.env) });
  }

  const before = settingsOf(current);
  const after = applyChange(before, change.set);

  // 2. A rule that needs the current state: a rollout above 0 on a flag that stays off
  //    reaches nobody. Only checked when the change sets a rollout.
  if ((change.set.rolloutPercent ?? 0) > 0 && !after.enabled) {
    return err({
      code: "rollout_needs_enabled",
      message: `${change.flagKey} is off in ${change.env}, so a rollout above 0 would reach nobody. Add "enabled": true to the change, or ask the user whether to turn it on.`,
    });
  }

  // 3. Nothing to confirm if the settings are already like that
  const changes = diff(before, after);
  if (changes.length === 0) {
    return err({
      code: "no_change",
      message: `Nothing would change: ${change.flagKey} already has these settings in ${change.env}.`,
    });
  }

  const expiresAt = new Date(now.getTime() + PROPOSAL_TTL_MINUTES * 60_000);
  return ok({
    changes,
    proposal: {
      id,
      flagKey: change.flagKey,
      env: change.env,
      reason: change.reason,
      baseRevision: current.revision,
      before,
      after,
      createdBy: user.id,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: "pending",
    },
  });
}

export type ConfirmErrorCode =
  "not_found" | "not_creator" | "forbidden" | "not_pending" | "expired" | "conflict";

/** HTTP status and user-facing message for each reason a confirm fails (FP-25). */
export const CONFIRM_ERRORS: Readonly<
  Record<ConfirmErrorCode, { status: number; message: string }>
> = {
  not_found: { status: 404, message: "This proposal doesn't exist." },
  not_creator: {
    status: 403,
    message: "Only the person who asked for this change can confirm it.",
  },
  forbidden: { status: 403, message: "You're no longer allowed to change this environment." },
  not_pending: { status: 409, message: "This proposal was already confirmed or discarded." },
  expired: { status: 410, message: "This proposal has expired. Ask the assistant again." },
  conflict: {
    status: 409,
    message:
      "The flag changed after this proposal was made. Ask the assistant again to see the new state.",
  },
};

/**
 * The checks the confirm step repeats on the server, in order (ADR-0002). Returns null
 * when the proposal may be applied. Things can change between propose and confirm
 * (role, other edits, time), so nothing from the propose step is trusted.
 */
export function checkConfirm(input: {
  proposal: Proposal;
  user: User;
  currentRevision: number;
  now: Date;
}): ConfirmErrorCode | null {
  const { proposal, user, currentRevision, now } = input;
  if (proposal.createdBy !== user.id) return "not_creator";
  if (!canWrite(user, proposal.env)) return "forbidden";
  if (proposal.status !== "pending") return "not_pending";
  if (now.getTime() >= Date.parse(proposal.expiresAt)) return "expired";
  if (currentRevision !== proposal.baseRevision) return "conflict";
  return null;
}
