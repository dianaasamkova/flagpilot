// Demo data for the fictional shop Bramble Market (FP-10). Invented from scratch.
// Each function returns a fresh copy, so every sandbox starts from the same state.
import type { EnvConfig, Flag, FlagEvent, Region, User } from "@flagpilot/domain";

/** The mock-auth users (FP-12): one per role. */
export const DEMO_USERS: readonly User[] = [
  { id: "u-viewer", name: "Vic Viewer", role: "viewer" },
  { id: "u-editor", name: "Erin Editor", role: "editor" },
  { id: "u-admin", name: "Ada Admin", role: "admin" },
];

const ALL: Region[] = ["EU", "NA", "APAC"];
const off = (revision = 0): EnvConfig => ({
  enabled: false,
  targeting: { regions: ["EU"] },
  rolloutPercent: 0,
  revision,
});
const on = (regions: Region[], rolloutPercent: number, revision = 1): EnvConfig => ({
  enabled: true,
  targeting: { regions },
  rolloutPercent,
  revision,
});

export function seedFlags(): Flag[] {
  return [
    {
      key: "checkout-one-page",
      description: "Shows the one-page checkout instead of the three-step one.",
      owner: "team-checkout",
      tags: ["release", "beta"],
      envs: { dev: on(ALL, 100), staging: on(["EU"], 50, 2), production: off() },
    },
    {
      key: "checkout-gift-wrap",
      description: "Lets shoppers add gift wrapping and a note at checkout.",
      owner: "team-checkout",
      tags: ["release"],
      envs: { dev: on(ALL, 100), staging: on(ALL, 100), production: on(ALL, 100, 2) },
    },
    {
      key: "payments-wallet-pay",
      description: "Offers paying with a phone wallet on the payment step.",
      owner: "team-checkout",
      tags: ["release"],
      envs: { dev: on(ALL, 100), staging: on(["EU", "NA"], 100), production: on(["NA"], 10) },
    },
    {
      key: "payments-fraud-check-v2",
      description: "Runs the new fraud check before a card payment is accepted.",
      owner: "team-platform",
      tags: ["ops"],
      envs: { dev: on(ALL, 100), staging: on(ALL, 100), production: on(ALL, 100) },
    },
    {
      key: "search-typo-tolerance",
      description: "Finds products even when the search has a small typo.",
      owner: "team-search",
      tags: ["experiment"],
      envs: { dev: on(ALL, 100), staging: on(ALL, 50), production: on(["EU"], 20) },
    },
    {
      key: "search-semantic-ranking",
      description: "Orders search results by meaning instead of exact words.",
      owner: "team-search",
      tags: ["experiment", "beta"],
      envs: { dev: on(ALL, 100), staging: off(), production: off() },
    },
    {
      key: "catalog-recommendations-v2",
      description: "Shows the new 'You may also like' row on product pages.",
      owner: "team-growth",
      tags: ["release"],
      envs: { dev: on(ALL, 100), staging: on(ALL, 100), production: on(["EU", "NA"], 30) },
    },
    {
      key: "catalog-legacy-reviews",
      description: "Shows the old review widget on product pages.",
      owner: "team-search",
      tags: ["release"],
      envs: { dev: off(1), staging: off(1), production: off(1) },
    },
    {
      key: "account-passwordless-login",
      description: "Lets shoppers sign in with a one-time link instead of a password.",
      owner: "team-growth",
      tags: ["beta"],
      envs: { dev: on(ALL, 100), staging: on(["EU"], 100), production: off() },
    },
    {
      key: "account-order-tracking",
      description: "Shows live delivery tracking in the order history.",
      owner: "team-growth",
      tags: ["release"],
      envs: { dev: on(ALL, 100), staging: on(ALL, 100), production: on(ALL, 75) },
    },
    {
      key: "platform-image-cdn",
      description: "Serves product images from the image CDN instead of the shop server.",
      owner: "team-platform",
      tags: ["ops", "permanent"],
      envs: { dev: on(ALL, 100), staging: on(ALL, 100), production: on(ALL, 100) },
    },
    {
      key: "platform-maintenance-mode",
      description: "Shows the maintenance page to every shopper. Kill switch for outages.",
      owner: "team-platform",
      tags: ["ops", "permanent"],
      envs: { dev: off(), staging: off(), production: off() },
    },
  ];
}

/** A few past changes, so explain_flag_history has something to explain. */
export function seedEvents(): FlagEvent[] {
  return [
    {
      id: "e-1",
      flagKey: "checkout-one-page",
      env: "staging",
      actor: "u-editor",
      at: "2026-11-02T09:00:00.000Z",
      reason: "Start the EU beta",
      before: { enabled: false, targeting: { regions: ["EU"] }, rolloutPercent: 0 },
      after: { enabled: true, targeting: { regions: ["EU"] }, rolloutPercent: 10 },
      revision: 1,
    },
    {
      id: "e-2",
      flagKey: "checkout-one-page",
      env: "staging",
      actor: "u-editor",
      at: "2026-11-10T14:30:00.000Z",
      reason: "No errors after a week, widen the beta",
      before: { enabled: true, targeting: { regions: ["EU"] }, rolloutPercent: 10 },
      after: { enabled: true, targeting: { regions: ["EU"] }, rolloutPercent: 50 },
      revision: 2,
    },
    {
      id: "e-3",
      flagKey: "checkout-gift-wrap",
      env: "production",
      actor: "u-admin",
      at: "2026-09-01T08:00:00.000Z",
      reason: "Full launch for the holiday season",
      before: { enabled: true, targeting: { regions: ALL }, rolloutPercent: 50 },
      after: { enabled: true, targeting: { regions: ALL }, rolloutPercent: 100 },
      revision: 2,
    },
    {
      id: "e-4",
      flagKey: "catalog-legacy-reviews",
      env: "production",
      actor: "u-admin",
      at: "2026-08-15T10:00:00.000Z",
      reason: "New review widget replaced it everywhere",
      before: { enabled: true, targeting: { regions: ALL }, rolloutPercent: 100 },
      after: { enabled: false, targeting: { regions: ["EU"] }, rolloutPercent: 0 },
      revision: 1,
    },
  ];
}
