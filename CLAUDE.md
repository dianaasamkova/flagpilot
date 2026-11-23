# FlagPilot: project rules

Rules for Claude Code in this repo. FlagPilot is built AI-first: the author owns the product, architecture and safety decisions (see docs/adr/), writes the specs and reviews every PR; Claude Code implements under the gates below.

## How we work
- **The author decides, Claude Code builds.** Claude Code writes the code, tests and docs, and proposes options with a recommendation. The author decides, reviews every PR and controls what merges.
- **Story types** (docs/BACKLOG.md): `core` (safety and correctness logic, reviewed line by line), `setup` (config, wiring, UI; normal review), `action` (only the author can do it: accounts, recordings, final wording).
- **PR descriptions** cover:
  - what changed, in plain words;
  - the lines that need the closest look;
  - how it was tested.
- **Gates:** wait for the author's OK before new ADRs, creating anything public (repo, issues, deploys), merging PRs, and moving to the next milestone.
- **Small steps:** one backlog story per PR when practical, on a branch, with CI green before merge.

## Constraints
- **Mock domain only** (the fictional Bramble Market). Everything is invented; no code, names or logic from any real company.
- **Zero cost:** Gemini free tier, Vercel Hobby, Neon Free, GitHub Actions. Paid APIs stay optional (ADR-0005, ADR-0006).
- Decisions live in docs/adr/. Accepted ADRs are never rewritten: add an "Amended by" or "Superseded by" line and write a new ADR.
- The plan is in docs/PLAN.md, the stories are in docs/BACKLOG.md, and per-milestone plans are in docs/plans/.

## Stack
pnpm workspace · Next.js App Router · TypeScript strict · zod (shared from `packages/domain`) · Prisma + Postgres (Neon) · Vitest · Playwright · MCP TypeScript SDK.
