// An in-memory FlagStore for tests and for running the app before the database exists.
// Everything is copied on the way in and out, so callers can't change stored data by
// accident, just like with a real database.
import {
  err,
  ok,
  type Environment,
  type Flag,
  type FlagEvent,
  type Proposal,
  type ProposalStatus,
  type Result,
} from "@flagpilot/domain";
import type { FlagStore } from "./store.ts";

export class MemoryFlagStore implements FlagStore {
  private readonly flags = new Map<string, Flag>();
  private readonly events: FlagEvent[] = [];
  private readonly proposals = new Map<string, Proposal>();

  constructor(seed: { flags: readonly Flag[]; events?: readonly FlagEvent[] }) {
    for (const flag of seed.flags) this.flags.set(flag.key, structuredClone(flag));
    this.events.push(...structuredClone(seed.events ?? []));
  }

  async listFlags(): Promise<Flag[]> {
    return structuredClone([...this.flags.values()]);
  }

  async getFlag(key: string): Promise<Flag | undefined> {
    return structuredClone(this.flags.get(key));
  }

  async listEvents(
    key: string,
    options: { env?: Environment | undefined; limit: number },
  ): Promise<FlagEvent[]> {
    const matching = this.events.filter(
      (event) => event.flagKey === key && (options.env === undefined || event.env === options.env),
    );
    // Newest first; ISO timestamps sort correctly as strings
    matching.sort((a, b) => b.at.localeCompare(a.at));
    return structuredClone(matching.slice(0, options.limit));
  }

  async saveProposal(proposal: Proposal): Promise<void> {
    this.proposals.set(proposal.id, structuredClone(proposal));
  }

  async getProposal(id: string): Promise<Proposal | undefined> {
    return structuredClone(this.proposals.get(id));
  }

  async setProposalStatus(id: string, status: ProposalStatus): Promise<void> {
    const proposal = this.proposals.get(id);
    if (proposal) proposal.status = status;
  }

  async applyProposal(
    proposal: Proposal,
    event: Omit<FlagEvent, "revision">,
  ): Promise<Result<FlagEvent, "conflict">> {
    // No await between the check and the writes, so nothing can run in between.
    // The Prisma store gets the same guarantee from a transaction.
    const flag = this.flags.get(proposal.flagKey);
    const current = flag?.envs[proposal.env];
    if (flag === undefined || current === undefined || current.revision !== proposal.baseRevision) {
      return err("conflict");
    }

    const revision = current.revision + 1;
    flag.envs[proposal.env] = { ...structuredClone(proposal.after), revision };
    const saved: FlagEvent = { ...structuredClone(event), revision };
    this.events.push(saved);
    const stored = this.proposals.get(proposal.id);
    if (stored) stored.status = "confirmed";
    return ok(structuredClone(saved));
  }
}
