// The append-only change log. Every confirmed change writes one FlagEvent; nothing
// edits or deletes them. It feeds explain_flag_history and, later, find_stale_flags.
import { z } from "zod";
import { EnvSettings, Environment, FlagKey } from "./flag.ts";

export const FlagEvent = z.strictObject({
  id: z.string().min(1),
  flagKey: FlagKey,
  env: Environment,
  // The user id of whoever confirmed the change
  actor: z.string().min(1),
  at: z.iso.datetime(),
  reason: z.string(),
  before: EnvSettings,
  after: EnvSettings,
  // The flag's revision after this change
  revision: z.int().min(1),
});
export type FlagEvent = z.infer<typeof FlagEvent>;
