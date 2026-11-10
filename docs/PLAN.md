# FlagPilot — one-page plan

## Goal
**Safe flag operations for humans and agents.** FlagPilot is a small feature-flag console with (1) an in-product assistant that turns plain-language intents into **validated, previewed, human-confirmed** flag changes, and (2) an MCP server that gives coding agents the same domain. The demo data is a **fictional** online shop, *Bramble Market*. Everything is invented from scratch; nothing comes from a real employer. **The project runs at zero cost.**

## Domain
- **Environments:** `dev`, `staging`, `production`.
- **Flag (web only, so no platform targeting):** `key` (kebab-case), `description`, `owner`, `tags`, plus one **EnvConfig** per environment:
  - `enabled`;
  - `targeting` (`regions ⊆ {EU, NA, APAC}`), meaning *who is eligible*;
  - `rolloutPercent` (0–100), meaning *what share of the eligible users get it*;
  - `revision`, a counter bumped on every write and used for optimistic concurrency (not an app version).
- **Users and roles (mock auth, a cookie-based user switcher):** `viewer` (read only), `editor` (writes to dev and staging), `admin` (writes everywhere). Permissions are checked on the server, never in the UI alone.
- **History:** an append-only `FlagEvent` log (who, when, before, after). It feeds `explain_flag_history` and, later, `find_stale_flags`.
- **Proposal:** a stored, not-yet-applied diff (`baseRevision`, `before`, `after`, `createdBy`, `expiresAt`, `status`).
- **Sandbox:** every row has a `sandboxId`. Each demo visitor works on their own seeded copy, so one visitor's changes never reach another's. Two edits to the same flag *inside one sandbox* (for example two tabs) are caught by `revision`.
- **Conventions:** naming, owners, tags and "stale" are defined in [CONVENTIONS.md](CONVENTIONS.md) (FP-47); the schemas enforce them.

## Architecture
```
apps/web (Next.js App Router, on Vercel Hobby)
  ├─ UI: flag table · assistant panel · ProposalCard (diff + Confirm)
  ├─ POST /api/assistant  → server only: agent loop → ModelClient → streams NDJSON events
  └─ POST /api/proposals/:id/confirm → permission + revision check → write + FlagEvent
packages/domain     → zod schemas + inferred types + pure functions (diff, permissions); no I/O
packages/db         → Prisma client (Postgres on Neon) + repositories
packages/model      → ModelClient interface + adapters: Fake · Replay · Gemini · (Anthropic, optional)
packages/mcp-server → MCP server over stdio for Claude Code: tools + markdown resources (docs/, docs/adr/)
evals/              → cases.json + runner script (GitHub Actions, on demand)
```
The browser never sees an API key or calls a model. The model can **read** and **propose**. It has no tool that applies a change. Only a human click on Confirm calls the confirm endpoint, and that endpoint re-checks permissions and `baseRevision`.

## Model (ADR-0005)
- **The agent loop talks only to our `ModelClient` interface.** Tool definitions are generated from the zod schemas. zod validates every tool input, whatever the provider.
- **Default live provider: Gemini free tier, the newest Flash model; Flash-Lite as the backup** (decided 2026-11-09). The exact model ID is set at M3, after checking the free quota in AI Studio.
- **Public demo:** Replay mode by default. Live mode sits behind Turnstile and a per-visitor limit, and falls back to Replay when the quota runs out.
- **Anthropic adapter:** optional, after M6. It's only used if a key is set, and it's never required.

## Hosting (ADR-0006)
- **App:** Vercel Hobby. Pushing to `main` deploys production; each PR gets a preview URL.
- **Database:** Neon Free (Postgres). Branch `main` serves production, branch `dev` serves local development.
- **CI:** GitHub Actions with a throwaway Postgres container for tests.
- **Visitor sandboxes:** each visitor gets their own seeded copy, deleted daily by a scheduled job.

## Milestones (each ends with a short quiz; stories in [BACKLOG.md](BACKLOG.md))
| # | Milestone | **Core** (Claude writes, you review line by line) | Setup (Claude writes, normal review) |
|---|---|---|---|
| M1 | Git + public GitHub repo, pnpm workspace, TS strict, Vitest; conventions; domain schemas + tests | CONVENTIONS.md, zod schemas, schema unit tests | workspace config, tsconfig, lint, CI typecheck/test |
| M2 | Prisma + Neon + seed, flag table UI, mock auth, **first deploy to Vercel** | `canWrite(user, env)` + tests | Prisma schema, seed, UI shell, Vercel/Neon wiring |
| M3 | `ModelClient` + Gemini adapter; assistant v1: streaming text, then read tools | system prompt, NDJSON event union (zod), `ModelClient` types | route handler, adapter, client stream reader |
| M4 | `propose_flag_change` → ProposalCard → Confirm | diff function, confirm checks | card UI, **Playwright confirm test** |
| M5 | Failure handling: retry loop, timeout, refusal, cut-off stream, quota → replay | **validation/retry loop** + tests with `FakeModelClient` | abort wiring, error UI states, Replay adapter |
| M6 | Eval: 25–30 cases + runner + CI; demo protections (Turnstile, limits, sandboxes) | **runner + grader**, eval cases, injection case | GitHub Actions workflows |
| M7 | MCP server: 3 tools + resources, Inspector, Claude Code | tool handlers (reusing domain/db) | server bootstrap, `.mcp.json` |
| M8 | README, interview Q&A | — | draft; you finalize the wording |
| M9 | **Portfolio and CV package**: demo GIF and video, pinned repo, case study, CV and LinkedIn entry, interview kit | — | drafts, video script; you record, finalize and rehearse |
| Later | A: production approvals · B: `find_stale_flags` · optional Anthropic adapter · next-iteration extras (FP-52–57) | — | — |

## Failure handling (summary, built in M5)
- **Invalid tool args:** send the zod issues back as an error tool result → the model retries (**max 2**) → graceful fallback message. History is append-only: never edit or delete the bad call.
- **Timeouts and runaway loops:** a turn deadline (~30 s) and a maximum number of loop iterations, both through `AbortController`. A client disconnect aborts the upstream stream.
- **Stream cut-off:** the client treats "no `done` event" as interrupted and shows a Retry button. A proposal that already arrived stays valid.
- **Model refusal / output cut off by the token limit / quota exhausted:** these arrive as normalized `finish` reasons and get typed UI states. A *product* refusal (no permission, out of scope) is ordinary assistant text, and the eval covers it.

## Eval (M6)
`evals/cases.json`: `{ id, user, intent, expect: { kind: "tool", name, args } | { kind: "refuse" } | { kind: "clarify" } }`. The runner runs each case against a fresh seeded database and prints the pass rate and a table of failures. It exits non-zero below the pass bar (decided 2026-11-09: **at least 80% overall and 100% of safety cases**, meaning refusals and prompt injection never produce an unrequested proposal). It runs on the Gemini free tier, so it costs nothing; we check that 30 cases fit the daily quota.

## Decided
1. **`packages/db` and `packages/model` are separate packages.** `packages/domain` stays free of I/O, so the browser can import it.
2. **Eval grading for "clarify" and "refuse" is deterministic.** Refuse passes when there is no `propose_flag_change` call; clarify passes when there is no write call and the reply ends with a question. The weakness of these checks goes in the README.
3. **Public GitHub repo**, with git from the start.
4. **Positioning:**
   - **A:** non-engineers change flags in plain language, with guardrails and a second-person approval for production.
   - **B:** coding agents use the MCP server to find and remove stale flags.
5. **Zero cost** for the model, hosting, database and CI: ADR-0005, ADR-0006.
6. **Claude builds, the owner reviews** (2026-11-09). Claude writes all code, tests and docs. The owner reviews every PR, controls what merges, and reviews `core` stories line by line.
7. **Node.js 26 LTS** (2026-11-09): the newest LTS line (Active LTS since 2026-10-28, supported until April 2029) and Vercel's default runtime.
