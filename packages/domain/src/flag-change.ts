// One requested edit to one flag in one environment (FP-7). The assistant proposes it,
// a person confirms it. The schema sees only the change itself: rules that need the
// flag's current state (e.g. "rollout above 0 needs the flag to be on") are checked
// by the server when the change is proposed (FP-23).
import { z } from "zod";
import { Environment, FlagKey, Regions, RolloutPercent } from "./flag.ts";

const SET_FIELDS = `"enabled", "regions" or "rolloutPercent"`;

/** True when at least one field has a value. `{ enabled: undefined }` counts as empty. */
function hasAtLeastOneField(set: Record<string, unknown>): boolean {
  return Object.values(set).some((value) => value !== undefined);
}

/** Turning a flag off while giving it a rollout above 0 contradicts itself. */
function isNotOffWithRollout(set: {
  enabled?: boolean | undefined;
  rolloutPercent?: number | undefined;
}): boolean {
  return !(set.enabled === false && (set.rolloutPercent ?? 0) > 0);
}

/** The fields to change. Leave a field out to keep its current value. */
export const FlagChangeSet = z
  .strictObject(
    {
      enabled: z
        .boolean({ error: "enabled must be true or false. Example: true." })
        .optional()
        .describe("Turn the flag on (true) or off (false)."),
      regions: Regions.optional().describe(
        "The regions that are eligible. Replaces the current list, so include every region you want.",
      ),
      rolloutPercent: RolloutPercent.optional().describe(
        "Share of the eligible users who get the feature, 0–100.",
      ),
    },
    {
      // Key, owner, description and tags can't be changed through a FlagChange
      error: (issue) =>
        issue.code === "unrecognized_keys"
          ? `set can only change ${SET_FIELDS}. Remove: ${issue.keys.join(", ")}.`
          : undefined,
    },
  )
  // Rule 1: the change isn't empty
  .refine(hasAtLeastOneField, {
    error: `set must change at least one of ${SET_FIELDS}. Example: { "enabled": true }.`,
  })
  // Rule 2: no "off, but 30% rollout"
  .refine(isNotOffWithRollout, {
    path: ["rolloutPercent"],
    error:
      'enabled: false with rolloutPercent above 0 contradicts itself: a flag that is off reaches nobody. Either set enabled to true, or set rolloutPercent to 0. Example: { "enabled": false, "rolloutPercent": 0 }.',
  });
// Rule 3 (regions: at least 1, no duplicates) comes from the shared Regions schema.
export type FlagChangeSet = z.infer<typeof FlagChangeSet>;

const REASON_HINT =
  'reason must be 3–200 characters saying why, for the history. Example: "Start the EU beta".';

// The descriptions below go into the JSON Schema the model sees (FP-8)
export const FlagChange = z.strictObject({
  flagKey: FlagKey.describe('The key of the flag to change, e.g. "checkout-new-button".'),
  env: Environment.describe("The environment to change."),
  set: FlagChangeSet.describe("The fields to change. Leave a field out to keep its current value."),
  // Written to the history (FlagEvent), so people can see why it changed
  reason: z
    .string({ error: REASON_HINT })
    .trim()
    .min(3, REASON_HINT)
    .max(200, REASON_HINT)
    .describe("Why the change is needed, in the user's words. Saved to the flag's history."),
});
export type FlagChange = z.infer<typeof FlagChange>;
