// Inputs of the tools the assistant can call (FP-8). The agent loop (M3) and the MCP
// server (M7) both use these schemas. The model gets the JSON Schema version; the server
// always validates again with zod, because JSON Schema drops the .refine rules (ADR-0003).
import { z } from "zod";
import { FlagChange } from "./flag-change.ts";
import { Environment, FlagKey, Tag } from "./flag.ts";

const QUERY_HINT = 'query must be 1–50 characters. Example: "checkout".';
const LIMIT_HINT = "limit must be a whole number from 1 to 50. Example: 10.";

/** list_flags: find flags. Every filter is optional; no filters lists every flag. */
export const ListFlagsInput = z
  .strictObject({
    env: Environment.optional().describe("Only look at this environment."),
    enabled: z
      .boolean({ error: "enabled must be true or false. Example: true." })
      .optional()
      .describe('Only flags that are on (true) or off (false) in "env". Needs "env".'),
    tag: Tag.optional().describe("Only flags with this tag."),
    query: z
      .string({ error: QUERY_HINT })
      .trim()
      .min(1, QUERY_HINT)
      .max(50, QUERY_HINT)
      .optional()
      .describe("Text to look for in the flag key and description, ignoring case."),
  })
  // "On" only means something in one environment, so the filter needs env
  .refine((input) => input.enabled === undefined || input.env !== undefined, {
    path: ["enabled"],
    error:
      'The enabled filter needs an environment: a flag can be on in staging and off in production. Add "env". Example: { "env": "staging", "enabled": true }.',
  });
export type ListFlagsInput = z.infer<typeof ListFlagsInput>;

/** get_flag: one flag with its settings in every environment. */
export const GetFlagInput = z.strictObject({
  key: FlagKey.describe('The flag key, e.g. "checkout-new-button".'),
});
export type GetFlagInput = z.infer<typeof GetFlagInput>;

/** propose_flag_change: prepare a change for a person to confirm. It never applies it. */
export const ProposeFlagChangeInput = FlagChange;
export type ProposeFlagChangeInput = z.infer<typeof ProposeFlagChangeInput>;

/** explain_flag_history: the latest changes to a flag, newest first. */
export const ExplainFlagHistoryInput = z.strictObject({
  key: FlagKey.describe('The flag key, e.g. "checkout-new-button".'),
  env: Environment.optional().describe("Only changes in this environment."),
  limit: z
    .int({ error: LIMIT_HINT })
    .min(1, LIMIT_HINT)
    .max(50, LIMIT_HINT)
    .default(10)
    .describe("How many changes to return, newest first. Default 10."),
});
export type ExplainFlagHistoryInput = z.infer<typeof ExplainFlagHistoryInput>;

/** Every tool name with its input schema. */
export const TOOL_INPUTS = {
  list_flags: ListFlagsInput,
  get_flag: GetFlagInput,
  propose_flag_change: ProposeFlagChangeInput,
  explain_flag_history: ExplainFlagHistoryInput,
} as const;
export type ToolName = keyof typeof TOOL_INPUTS;

/**
 * The JSON Schema the model sees for a tool's input. "input" mode describes what the
 * caller sends, so fields with a default (like limit) stay optional.
 */
export function toolInputJsonSchema(name: ToolName) {
  return z.toJSONSchema(TOOL_INPUTS[name], { io: "input" });
}
