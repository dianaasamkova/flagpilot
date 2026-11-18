// The fixed lists from docs/CONVENTIONS.md. Change them in the same PR as that file:
// test/conventions.test.ts fails when the two drift apart.

/** Shop areas. Every flag key starts with one of them: `checkout-new-button`. */
export const AREAS = ["checkout", "search", "catalog", "account", "payments", "platform"] as const;

/** Teams that can own a flag. An owner is always a team, never a person. */
export const TEAMS = ["team-checkout", "team-search", "team-growth", "team-platform"] as const;

/** Tags a flag can carry. `permanent` keeps a flag out of the stale list. */
export const TAGS = ["release", "experiment", "ops", "permanent", "beta"] as const;
