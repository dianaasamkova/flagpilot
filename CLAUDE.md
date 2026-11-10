# FlagPilot: working rules

A portfolio project. The owner must understand every line and be able to explain every `core` line in an interview.

## How we work
- **The owner directs, Claude builds.** The ideas and decisions are the owner's. Claude writes all code, tests and docs, and proposes options with a recommendation. The owner decides, reviews every PR and controls the process: nothing merges without their approval.
- **Story types** (docs/BACKLOG.md): `core` (safety and correctness logic, reviewed line by line), `setup` (config, wiring, UI; normal review), `action` (only the owner can do it: accounts, recordings, final wording).
- **Explain simply and briefly,** at a junior level. Before each story, say in 2–3 sentences what will be built and why. In each PR description:
  - what changed, in plain words;
  - the lines that need the closest look;
  - how it was tested;
  - for `core` stories, how to explain it in an interview.
- A short quiz (about 5 questions) after each milestone.
- Wait for the owner's OK at gates: new ADRs, creating anything public (repo, issues, deploys), merging PRs, and moving to the next milestone.
- Small steps: one backlog story per PR when practical, on a branch, with CI green before merge.

## Constraints
- **Mock domain only** (the fictional Bramble Market). Never use code, names or logic from the owner's employer, and don't read the owner's other work projects.
- **Zero cost:** Gemini free tier, Vercel Hobby, Neon Free, GitHub Actions. Paid APIs stay optional (ADR-0005, ADR-0006).
- Decisions live in docs/adr/. Accepted ADRs are never rewritten: add an "Amended by" or "Superseded by" line and write a new ADR.
- The plan is in docs/PLAN.md and the stories are in docs/BACKLOG.md. Day 1 is in docs/KICKOFF.md.

## Stack
pnpm workspace · Next.js App Router · TypeScript strict · zod (shared from `packages/domain`) · Prisma + Postgres (Neon) · Vitest · Playwright · MCP TypeScript SDK.
