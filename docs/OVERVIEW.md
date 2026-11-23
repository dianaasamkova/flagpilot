# FlagPilot: overview

The short version of the project. Details live in [PLAN.md](PLAN.md), [BACKLOG.md](BACKLOG.md) and [adr/](adr/).

## What it is
A website for managing **feature flags**: on/off switches for features of a fictional shop, *Bramble Market*. It has two extra parts:
1. **An assistant.** You type "turn on the new checkout in staging for EU". The AI prepares the change, and you click Confirm.
2. **An MCP server.** Coding agents such as Claude Code can read the same flags.

Everything is free to run and public on GitHub, with a live demo link.

## How one request works
1. You type a request in the assistant panel.
2. The browser sends it to **our server**. The browser never talks to the AI.
3. The server asks the AI (Gemini, free tier). The AI can only call 3 tools: `list_flags`, `get_flag`, `propose_flag_change`.
4. zod checks the AI's tool inputs.
   - If they're bad, the AI gets the error and tries again (at most 2 retries).
   - If it still fails, the user gets a polite message instead.
5. The server checks permissions and saves a **proposal**. Nothing has changed yet.
6. You see a **card** showing before and after, and you click **Confirm**.
7. The server checks again: who you are, your role, whether the proposal has expired, and whether the flag changed meanwhile (`revision`). Only then does it save the change and write a history event.

**Main rule:** the AI never changes anything. Only a human click does.

## Key words
| Word | Meaning |
|---|---|
| Flag | A named switch, e.g. `checkout-new-button` |
| Environment | `dev`, `staging` or `production`. Each flag has its own settings in each |
| Targeting | Which regions are eligible: EU, NA, APAC |
| Rollout % | What share of those eligible users get the feature |
| Revision | A counter that goes up on every change. It stops two edits from overwriting each other |
| Proposal | A change the AI prepared that hasn't been applied yet |
| Sandbox | A demo visitor's own copy of the data |
| Role | `viewer` can only read; `editor` can change dev and staging; `admin` can change everything |
| zod | A library that checks data shape and rules, and gives readable errors |
| ADR | A short record of one decision and why we made it |
| Eval | An automatic test of the AI with 25–30 example requests |

## Files today
The workspace, CI, domain schemas and safety core are in place. The app runs locally on an in-memory store with an offline demo model (see the [README](../README.md)). Postgres, Gemini and the MCP server come in later milestones.

| File | What's inside |
|---|---|
| `README.md` | What FlagPilot is, how to run it locally, how it's built |
| `CLAUDE.md` | Project rules for Claude Code: gates, zero cost, mock domain, conventions |
| `docs/OVERVIEW.md` | This page |
| `docs/PLAN.md` | One-page plan: domain, architecture, milestones, failure handling, eval |
| `docs/BACKLOG.md` | All stories, each with a type and a "done when" |
| `docs/CONVENTIONS.md` | Flag key naming, owners, tags, and what makes a flag "stale" (FP-47) |
| `docs/plans/M1.md` | Detailed plan for M1: versions, files, PR order, schema rules, risks. Later milestones get their own file before they start |
| `docs/adr/0001` | The AI acts only through tool calls, not free text |
| `docs/adr/0002` | Confirm before write: proposal, card, re-check, save |
| `docs/adr/0003` | One set of zod schemas shared everywhere |
| `docs/adr/0004` | We write the agent loop ourselves and stream events as NDJSON |
| `docs/adr/0005` | Our own `ModelClient` interface; Gemini free tier by default |
| `docs/adr/0006` | Free hosting: Vercel, Neon Postgres, GitHub Actions |
| `apps/web/` | Next.js app: flag table, user switcher, assistant panel, proposal card; routes `/api/assistant` and `/api/proposals/[id]/{confirm,discard}`; agent loop and system prompt in `lib/assistant/` |
| `packages/domain/` | zod schemas (flag, `FlagChange`, tool inputs, proposal, history, stream events), convention lists, `diff`, `canWrite` |
| `packages/db/` | `FlagStore` contract, in-memory store, Bramble Market seed data, propose and confirm actions. The Prisma store arrives in M2 |
| `packages/model/` | `ModelClient` interface, a scripted fake for tests, an offline demo model. The Gemini adapter arrives in M3 |
| `packages/mcp-server/` | Stub, filled in M7 |
| `test/` | Repo-wide checks: every package follows the shared setup; `CONVENTIONS.md` and the code agree |
| `.github/workflows/ci.yml` | CI on every PR: format check, typecheck, lint, test, build |

## What goes where
```
apps/web/              Next.js website: flag table, assistant panel, Confirm card, API routes
packages/domain/       zod schemas + pure functions (diff, permissions). No database, no network
packages/db/           Prisma: database tables and queries
packages/model/        ModelClient + adapters: Fake (tests), Replay (demo), Gemini (live)
packages/mcp-server/   MCP server for Claude Code
evals/                 cases.json + runner script (to be created in M6)
.github/workflows/     CI: typecheck, lint, tests; eval on demand
```

## How it's built
Built AI-first: I own the product, architecture and safety decisions (see [adr/](adr/)), write the specs and review every PR; Claude Code implements under the gates in [CLAUDE.md](../CLAUDE.md). Nothing merges without my review and green CI.
- **core** stories are the safety logic. They are reviewed line by line.
- **setup** stories (config, wiring, UI) get a normal review.
- **action** stories are things only the author can do: accounts, recordings, final wording.

| # | What we build | Core (reviewed line by line) |
|---|---|---|
| M1 | Repo, workspace, CI, conventions, schemas | CONVENTIONS.md, zod schemas, tests |
| M2 | Database, flag table, fake login, **first deploy** | `canWrite(user, env)` |
| M3 | Assistant: streaming text + read tools | system prompt, event schema, `ModelClient` types |
| M4 | Propose → card → Confirm | `diff`, propose logic, confirm checks |
| M5 | Failure handling | **retry loop** |
| M6 | Eval + demo protection | **eval runner**, eval cases, injection case |
| M7 | MCP server | tool handlers |
| M8 | README and docs | — |
| Later | Approvals, `find_stale_flags`, Claude adapter, next-iteration extras | — |

## Gaps found on 2026-11-09 (all added)
| Gap | Why it matters | Story |
|---|---|---|
| System prompt | Tells the AI its job and limits | FP-48 (new) |
| Conventions doc | The MCP server serves it; the schemas enforce it | FP-47 (new) |
| `explain_flag_history` schema | Every tool needs input validation | FP-8 (extended) |
| `sandboxId` on every row | Visitors don't see each other's changes; costly to add later | FP-10 (extended) |
| Replay prompt buttons | Recordings can't answer new questions | FP-49 (new) |
| Repo hygiene | LICENSE, `.gitignore`, `.env.example`, secret blocking | FP-1 (extended) |
| Data-use notice | Free-tier input may be used by Google | FP-50 (new) |
| Prompt injection | A flag description could try to trick the AI | FP-51 (new) |
| MCP database settings | Passwords must stay out of git | FP-37 (extended) |

## Decided on 2026-11-09
- **Workflow:** AI-first. Claude Code builds; I decide, review every PR and control what merges.
- **Node.js 26 LTS:** the newest LTS line, supported until April 2029, and Vercel's default.
- **Nice-to-haves** go to the next iteration (FP-52 to FP-57).
- **Gemini:** the newest Flash model, with Flash-Lite as backup. The exact model ID is set at M3 after checking the free quota.
- **Eval pass bar:** at least 80% overall and 100% on safety cases.
