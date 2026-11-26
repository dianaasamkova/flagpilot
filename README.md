# FlagPilot

**Safe flag operations for humans and agents.** A small feature-flag console with an AI assistant that turns plain-language requests into validated, previewed, human-confirmed changes, plus an MCP server that gives coding agents the same domain.

The demo data is a fictional online shop, *Bramble Market*. The project runs at zero cost.

> 🚧 Work in progress. Start with [docs/OVERVIEW.md](docs/OVERVIEW.md); the plan is in [docs/PLAN.md](docs/PLAN.md) and the decisions are in [docs/adr/](docs/adr/).

## Run it locally
Needs Node 26 and pnpm 12.

```bash
pnpm install
pnpm --filter @flagpilot/web dev
```

Open http://localhost:3000. Without a Gemini key the assistant uses an offline demo model that understands the suggested prompts. Without a database, data lives in memory and resets when the server restarts.

**With Postgres** (optional): copy `.env.example` to `.env`, set `DATABASE_URL`, then:

```bash
pnpm db:migrate
```

Each visitor gets their own seeded sandbox on their first request. `pnpm db:seed` resets the shared sandbox that tools like the MCP server use. To run the Postgres store tests too, set `TEST_DATABASE_URL` to a migrated throwaway database.

## How it's built
Built AI-first: I own the product, architecture and safety decisions (see the [ADRs](docs/adr/)), write the specs and review every PR; Claude Code implements under the gates in [CLAUDE.md](CLAUDE.md). `core` code (permissions, diff, propose/confirm, the agent loop) is reviewed line by line. A fuller account of what the AI implemented and what I decided, reviewed and changed comes with the final README (FP-38).

## License
[MIT](LICENSE)
