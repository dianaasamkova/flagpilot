# ADR-0006: Zero-cost hosting on Vercel Hobby, Neon Free and GitHub Actions

- Status: Accepted
- Date: 2026-11-06
- Supersedes: the SQLite choice in PLAN.md

## Context
The demo must be **clickable without cloning the repo** and must **cost nothing** (PLAN, decision 5). SQLite was chosen when the app only ran locally. On serverless hosting the filesystem doesn't persist between requests, so SQLite writes would be lost. Limits below were checked against the providers' pricing pages on 2026-11-06.

## Decision

| Concern | Choice | Free limits that matter to us |
|---|---|---|
| App hosting | **Vercel Hobby**, connected to the GitHub repo | 300 s max function duration; 1M invocations, 4 active-CPU hours a month. Personal, non-commercial use only. Going over a limit pauses the feature until 30 days have passed. |
| Database | **Neon Free** (Postgres) with Prisma | 1 GB storage and 100 compute-hours a month per project; 10 branches. Suspends after 5 min idle and wakes in a few hundred ms. No credit card. |
| CI | **GitHub Actions** | Free for public repos. Tests use a throwaway Postgres container, never Neon. |
| Bot protection | **Cloudflare Turnstile** on live mode | Free |

- **Environments:** pushing to `main` deploys production. Each PR gets a Vercel preview URL. Neon branch `main` serves production, and branch `dev` serves local development, so there is no local Docker requirement.
- **Migrations:** `prisma migrate deploy` runs in the deploy pipeline, never from a developer laptop against production.
- **Secrets:** `DATABASE_URL` and `GEMINI_API_KEY` live in Vercel's server-side environment variables. Nothing model- or database-related uses `NEXT_PUBLIC_*`.
- **Public demo safety:**
  - one sandbox per visitor (a seeded copy keyed by a cookie), deleted daily by a scheduled GitHub Actions job;
  - a per-visitor message limit;
  - rate limiting in the API routes;
  - replay mode as the fallback when the Gemini quota runs out (ADR-0005).
- **Deploy early:** the first production deploy happens at the end of M2 (flag table plus database), not at the end of the project.

## Consequences
- **Zero cost, and a live URL for the README and CV.**
- **Postgres everywhere** (Neon in development and production, a container in CI), so there are no differences between SQLite and Postgres behaviour. `targeting` can become a real JSON column, still parsed with zod when read (ADR-0003).
- **Risks we accept:**
  - Hobby's pause-for-30-days on overuse means abuse could take the demo offline. Rate limits and Turnstile are therefore required, not optional.
  - Neon's cold start adds a short delay to the first request after idle time.
  - Hobby forbids commercial use, so moving to Pro is the first cost if direction A ever earns money.
- **Development needs internet** for the Neon `dev` branch. Docker Postgres remains an optional offline setup.
- **Accounts the owner creates (not automated):** Vercel and Neon (sign in with GitHub), and a Google AI Studio API key.

## Alternatives considered
- **SQLite on a server that keeps its disk:** the free options either sleep a lot or no longer exist for new users. It also gives a weaker "production-like" story.
- **Turso (hosted SQLite):** would keep SQLite, but Prisma migrations against it need extra manual steps. Postgres is the more common skill in job ads.
- **Supabase Free:** also good. We chose Neon for its branches (dev/main) and because we don't need Supabase's auth or storage.
- **Self-hosting on a free cloud VM:** free but much more operations work, which isn't the skill this project is meant to show.
