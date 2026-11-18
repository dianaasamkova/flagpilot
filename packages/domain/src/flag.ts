// The basic flag shapes (FP-6). Every error message says what is wrong, how to fix it,
// and gives an example, because the assistant reads these messages and retries (ADR-0003).
import { z } from "zod";
import { AREAS, TAGS, TEAMS } from "./conventions.ts";

/** Joins values for a message: ["a", "b", "c"] → `"a", "b" or "c"`. */
function oneOf(values: readonly string[]): string {
  const quoted = values.map((value) => `"${value}"`);
  return `${quoted.slice(0, -1).join(", ")} or ${quoted.at(-1)}`;
}

/** True when no item appears twice. */
function hasNoDuplicates(items: readonly unknown[]): boolean {
  return new Set(items).size === items.length;
}

export const ENVIRONMENTS = ["dev", "staging", "production"] as const;
export const Environment = z.enum(ENVIRONMENTS, {
  error: `Environment must be ${oneOf(ENVIRONMENTS)}. Example: "staging".`,
});
export type Environment = z.infer<typeof Environment>;

export const REGIONS = ["EU", "NA", "APAC"] as const;
export const Region = z.enum(REGIONS, {
  error: `Region must be ${oneOf(REGIONS)} (capital letters). Example: "EU".`,
});
export type Region = z.infer<typeof Region>;

const KEY_EXAMPLE = `Example: "checkout-new-button".`;
// Lowercase letters and digits, words joined by single hyphens, first character a letter.
const KEBAB_CASE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** True when the key is `<area>-<at least one more word>`, with a known area. */
function startsWithArea(key: string): boolean {
  const words = key.split("-");
  return words.length >= 2 && AREAS.some((area) => area === words[0]);
}

export const FlagKey = z
  .string({ error: `Flag key must be a string. ${KEY_EXAMPLE}` })
  .min(3, `Flag key is too short: use 3–64 characters. ${KEY_EXAMPLE}`)
  .max(64, `Flag key is too long: use 3–64 characters. ${KEY_EXAMPLE}`)
  // abort: if the format is wrong, skip the area check, so the model gets one clear message
  .regex(KEBAB_CASE, {
    abort: true,
    error: `Flag key must be kebab-case: lowercase letters and digits, words joined by single hyphens, starting with a letter. ${KEY_EXAMPLE}`,
  })
  .refine(startsWithArea, {
    error: `Flag key must start with an area (${oneOf(AREAS)}) followed by at least one more word. ${KEY_EXAMPLE}`,
  });
export type FlagKey = z.infer<typeof FlagKey>;

/** Eligible regions: at least one, none repeated. Reused by FlagChange (FP-7). */
export const Regions = z
  .array(Region, { error: `Regions must be a list. Example: ["EU", "NA"].` })
  .min(
    1,
    `Choose at least one region (${oneOf(REGIONS)}). To reach nobody, turn the flag off instead. Example: ["EU"].`,
  )
  .refine(hasNoDuplicates, {
    error: `Each region may appear only once. Remove the repeated one. Example: ["EU", "NA"].`,
  });

/** Who is eligible for the flag. */
export const Targeting = z.strictObject({ regions: Regions });
export type Targeting = z.infer<typeof Targeting>;

const ROLLOUT_HINT = "rolloutPercent must be a whole number from 0 to 100. Example: 25.";
const REVISION_HINT = "revision must be a whole number, 0 or more. Example: 3.";

/** A flag's settings in one environment. */
export const EnvConfig = z.strictObject({
  enabled: z.boolean({ error: "enabled must be true or false. Example: true." }),
  targeting: Targeting,
  // Share of the eligible users who get the feature
  rolloutPercent: z.int({ error: ROLLOUT_HINT }).min(0, ROLLOUT_HINT).max(100, ROLLOUT_HINT),
  // Goes up by 1 on every change; stops two edits from overwriting each other
  revision: z.int({ error: REVISION_HINT }).min(0, REVISION_HINT),
});
export type EnvConfig = z.infer<typeof EnvConfig>;

const DESCRIPTION_HINT =
  'description must be 1–280 characters saying what users see when the flag is on. Example: "Shows the one-page checkout."';

export const Team = z.enum(TEAMS, {
  error: `owner must be a team, not a person: ${oneOf(TEAMS)}. Example: "team-checkout".`,
});
export type Team = z.infer<typeof Team>;

export const Tag = z.enum(TAGS, {
  error: `Tag must be ${oneOf(TAGS)}. Example: "release".`,
});
export type Tag = z.infer<typeof Tag>;

/** A feature flag with one EnvConfig for each environment. */
export const Flag = z.strictObject({
  key: FlagKey,
  // trim first, so a description of only spaces counts as empty
  description: z
    .string({ error: DESCRIPTION_HINT })
    .trim()
    .min(1, DESCRIPTION_HINT)
    .max(280, DESCRIPTION_HINT),
  owner: Team,
  tags: z
    .array(Tag, { error: `tags must be a list. Example: ["release"].` })
    .refine(hasNoDuplicates, {
      error: `Each tag may appear only once. Remove the repeated one. Example: ["release", "beta"].`,
    }),
  // One entry per environment, all three required
  envs: z.strictObject({ dev: EnvConfig, staging: EnvConfig, production: EnvConfig }),
});
export type Flag = z.infer<typeof Flag>;
