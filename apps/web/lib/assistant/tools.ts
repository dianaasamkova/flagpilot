// The four tools: what the model is told about them, and what they do (FP-20, FP-23).
// Inputs arrive already validated by the loop, with the shared schemas.
import { proposeChange, type Deps, type FlagStore } from "@flagpilot/db";
import {
  TOOL_INPUTS,
  toolInputJsonSchema,
  type ExplainFlagHistoryInput,
  type Flag,
  type GetFlagInput,
  type ListFlagsInput,
  type Proposal,
  type ProposeFlagChangeInput,
  type ToolName,
  type User,
} from "@flagpilot/domain";
import type { ToolDefinition } from "@flagpilot/model";

const DESCRIPTIONS: Record<ToolName, string> = {
  list_flags:
    "Find feature flags. Returns each flag's key, description, owner, tags and settings per environment. Use it to find the exact key before get_flag or propose_flag_change.",
  get_flag: "Get one flag with its settings in every environment.",
  propose_flag_change:
    "Prepare a change to one flag in one environment for the user to review. It does NOT apply the change: the user sees a card and clicks Confirm. Look at the flag first so you know its current settings.",
  explain_flag_history:
    "Get the latest confirmed changes to a flag, newest first: who, when, why, and the settings before and after.",
};

/** What the model sees: name, description and the JSON Schema of the input. */
export const TOOL_DEFINITIONS: ToolDefinition[] = (Object.keys(TOOL_INPUTS) as ToolName[]).map(
  (name) => ({
    name,
    description: DESCRIPTIONS[name],
    inputSchema: toolInputJsonSchema(name),
  }),
);

/** A tool's result. A proposal travels separately so the UI renders it as a card. */
export type ToolOutcome =
  { ok: true; data: unknown; proposal?: Proposal } | { ok: false; message: string };

export type ToolHandlers = {
  list_flags(input: ListFlagsInput): Promise<ToolOutcome>;
  get_flag(input: GetFlagInput): Promise<ToolOutcome>;
  propose_flag_change(input: ProposeFlagChangeInput): Promise<ToolOutcome>;
  explain_flag_history(input: ExplainFlagHistoryInput): Promise<ToolOutcome>;
};

const notFound = (key: string): ToolOutcome => ({
  ok: false,
  message: `No flag with the key "${key}". Use list_flags to find the right key.`,
});

/** True when the flag passes every filter of list_flags. */
function matches(flag: Flag, input: ListFlagsInput): boolean {
  if (input.env !== undefined && input.enabled !== undefined) {
    if (flag.envs[input.env].enabled !== input.enabled) return false;
  }
  if (input.tag !== undefined && !flag.tags.includes(input.tag)) return false;
  if (input.query !== undefined) {
    const query = input.query.toLowerCase();
    const text = `${flag.key} ${flag.description}`.toLowerCase();
    if (!text.includes(query)) return false;
  }
  return true;
}

/** The tools for one user in one sandbox (the store is already scoped to it). */
export function createToolHandlers(store: FlagStore, user: User, deps: Deps = {}): ToolHandlers {
  return {
    async list_flags(input) {
      const flags = (await store.listFlags()).filter((flag) => matches(flag, input));
      // With an environment, only show that environment's settings: less for the model to read
      const data = flags.map((flag) =>
        input.env === undefined ? flag : { ...flag, envs: { [input.env]: flag.envs[input.env] } },
      );
      return { ok: true, data };
    },

    async get_flag(input) {
      const flag = await store.getFlag(input.key);
      return flag === undefined ? notFound(input.key) : { ok: true, data: flag };
    },

    async propose_flag_change(input) {
      const result = await proposeChange(store, user, input, deps);
      if (!result.ok) return { ok: false, message: result.error.message };
      const { proposal, changes } = result.value;
      return {
        ok: true,
        proposal,
        data: {
          proposalId: proposal.id,
          status: "pending",
          changes,
          note: "Nothing has changed yet. The user now sees a card with Confirm and Discard. Tell them to review it.",
        },
      };
    },

    async explain_flag_history(input) {
      if ((await store.getFlag(input.key)) === undefined) return notFound(input.key);
      const events = await store.listEvents(input.key, { env: input.env, limit: input.limit });
      return { ok: true, data: events };
    },
  };
}
