# Day 1 kickoff (M1)

About 2–3 hours. Goal: a public repo, a working workspace with CI, and **the first schemas built and reviewed by you**.

## Before we start (5 min, you)
- [x] Node: **26 LTS** (decided 2026-11-09). Claude installs it at the start, after your OK, and pins it in `.nvmrc` and `package.json` `engines`.
- [x] Tracker: **GitHub Projects** (decided 2026-11-06).
- [x] Git author: global config, Diana Samkova <dianasamkovau@gmail.com>.
- [x] GitHub CLI has the `project` permission (2026-11-09).

## Session plan
Claude writes everything, and you review and approve each PR. **core** means you review it line by line.

| # | Step | Who | Backlog |
|---|---|---|---|
| 0 | ✅ [plans/M1.md](plans/M1.md) approved (2026-11-09) | you | — |
| 1 | Install Node 26 LTS | Claude, after your OK | — |
| 2 | `git init`, first commit of `docs/`, create the public repo `flagpilot` with `gh`, push | Claude, after your OK | FP-1 |
| 3 | GitHub Projects board (Backlog / Ready / In progress / In review / Done), labels (`core`, `setup`, `action`), milestones M1–M9; import BACKLOG.md as issues | Claude, after your OK | FP-2 |
| 4 | Workspace, tooling and CI on branch `m1-foundation`; open a PR; **you review and merge** | Claude → you | FP-3–5 |
| 5 | **Discuss** the conventions (15 min), then Claude writes `docs/CONVENTIONS.md`; you review | both | FP-47 |
| 6 | **Explainer (5 min):** zod `safeParse` vs `parse`, `z.infer`, `refine`, enums, error messages a model can act on | Claude explains | — |
| 7 | Domain schemas + tests; PR; **you review line by line** (core) | Claude → you | FP-6 |
| 8 | `FlagChange` with its rules + tests; PR; **you review line by line** (core) | Claude → you | FP-7 |
| 9 | M1 quiz: 5 short questions (at the end of M1, possibly day 2) | Claude asks | — |

## Done for day 1
Repo public · board populated · CI green · FP-3–5 and FP-6 merged · FP-7 in review.
