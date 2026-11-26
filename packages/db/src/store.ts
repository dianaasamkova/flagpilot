// The storage contract (FP-11). One store instance serves one sandbox: a demo visitor's
// own copy of the data, so the sandbox filter can't be forgotten in a query.
// MemoryFlagStore (tests, local runs without a database) and PrismaFlagStore (Postgres)
// implement it, and test/store-contract.ts runs the same tests against both.
import type {
  Environment,
  Flag,
  FlagEvent,
  Proposal,
  ProposalStatus,
  Result,
} from "@flagpilot/domain";

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
  setProposalStatus(id: string, status: ProposalStatus): Promise<void>;

  /**
   * Applies a proposal as one atomic step (one transaction in Postgres):
   * 1. check that the flag's revision still equals proposal.baseRevision;
   * 2. write proposal.after and add 1 to the revision;
   * 3. append the FlagEvent;
   * 4. mark the proposal confirmed.
   * If the revision moved on, nothing is written and the result is "conflict".
   */
  applyProposal(
    proposal: Proposal,
    event: Omit<FlagEvent, "revision">,
  ): Promise<Result<FlagEvent, "conflict">>;
}
