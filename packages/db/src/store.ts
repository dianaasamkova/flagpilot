// The storage contract (FP-11). One store instance serves one sandbox: a demo visitor's
// own copy of the data, so the sandbox filter can't be forgotten in a query.
// MemoryFlagStore (tests, local runs without a database) and PrismaFlagStore (Postgres)
// implement it, and test/store-contract.ts runs the same tests against both.
import type { Environment, Flag, FlagEvent, Proposal, Result } from "@flagpilot/domain";

export interface FlagStore {
  /** Every flag, sorted by key. */
  listFlags(): Promise<Flag[]>;
  getFlag(key: string): Promise<Flag | undefined>;
  /** A flag's history, newest first. */
  listEvents(
    key: string,
    options: { env?: Environment | undefined; limit: number },
  ): Promise<FlagEvent[]>;

  saveProposal(proposal: Proposal): Promise<void>;
  getProposal(id: string): Promise<Proposal | undefined>;
  /**
   * Marks a proposal discarded, but only while it's still pending. Returns false when it
   * isn't (missing, or a Confirm got there first), and then changes nothing.
   */
  discardPendingProposal(id: string): Promise<boolean>;

  /**
   * Applies a proposal as one atomic step (one transaction in Postgres):
   * 1. check that the stored proposal is still pending, and mark it confirmed;
   * 2. check that the flag's revision still equals proposal.baseRevision;
   * 3. write proposal.after and add 1 to the revision;
   * 4. append the FlagEvent.
   * The caller checked both earlier, but a Discard or another Confirm can land in between,
   * so they're checked again here. If either fails, nothing is written: "not_pending" when
   * the proposal was discarded or confirmed meanwhile, "conflict" when the flag moved on.
   */
  applyProposal(
    proposal: Proposal,
    event: Omit<FlagEvent, "revision">,
  ): Promise<Result<FlagEvent, "conflict" | "not_pending">>;
}
