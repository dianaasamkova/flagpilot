// The two write paths of ADR-0002, on top of any FlagStore (FP-23, FP-25).
// The rules live in packages/domain; these functions load, check and save.
import {
  buildProposal,
  checkConfirm,
  err,
  ok,
  type ConfirmErrorCode,
  type FieldDiff,
  type FlagChange,
  type FlagEvent,
  type Proposal,
  type ProposeError,
  type Result,
  type User,
} from "@flagpilot/domain";
import type { FlagStore } from "./store.ts";

/** Clock and id generator, replaceable in tests. */
export type Deps = { now?: () => Date; newId?: () => string };
const defaultNow = () => new Date();
const defaultNewId = () => crypto.randomUUID();

export type ProposeFailure = ProposeError | { code: "not_found"; message: string };

/**
 * propose_flag_change: stores a pending proposal. It never changes the flag.
 * The change must already be validated with the FlagChange schema.
 */
export async function proposeChange(
  store: FlagStore,
  user: User,
  change: FlagChange,
  deps: Deps = {},
): Promise<Result<{ proposal: Proposal; changes: FieldDiff[] }, ProposeFailure>> {
  const flag = await store.getFlag(change.flagKey);
  if (flag === undefined) {
    return err({
      code: "not_found",
      message: `No flag with the key "${change.flagKey}". Use list_flags to find the right key.`,
    });
  }

  const built = buildProposal({
    id: (deps.newId ?? defaultNewId)(),
    user,
    change,
    current: flag.envs[change.env],
    now: (deps.now ?? defaultNow)(),
  });
  if (!built.ok) return built;

  await store.saveProposal(built.value.proposal);
  return built;
}

/**
 * The Confirm click: re-checks everything on the server, then applies the change and
 * writes the history event in one atomic store call.
 */
export async function confirmProposal(
  store: FlagStore,
  user: User,
  proposalId: string,
  deps: Deps = {},
): Promise<Result<FlagEvent, ConfirmErrorCode>> {
  const proposal = await store.getProposal(proposalId);
  if (proposal === undefined) return err("not_found");
  const flag = await store.getFlag(proposal.flagKey);
  if (flag === undefined) return err("not_found");

  const now = (deps.now ?? defaultNow)();
  const problem = checkConfirm({
    proposal,
    user,
    currentRevision: flag.envs[proposal.env].revision,
    now,
  });
  if (problem !== null) return err(problem);

  // applyProposal checks the revision again inside the atomic step: another confirm
  // could have landed between our read above and this write.
  return store.applyProposal(proposal, {
    id: (deps.newId ?? defaultNewId)(),
    flagKey: proposal.flagKey,
    env: proposal.env,
    actor: user.id,
    at: now.toISOString(),
    reason: proposal.reason,
    before: proposal.before,
    after: proposal.after,
  });
}

/** The Discard click. Only the creator can discard, and only a pending proposal. */
export async function discardProposal(
  store: FlagStore,
  user: User,
  proposalId: string,
): Promise<Result<null, "not_found" | "not_creator" | "not_pending">> {
  const proposal = await store.getProposal(proposalId);
  if (proposal === undefined) return err("not_found");
  if (proposal.createdBy !== user.id) return err("not_creator");
  if (proposal.status !== "pending") return err("not_pending");
  await store.setProposalStatus(proposalId, "discarded");
  return ok(null);
}
