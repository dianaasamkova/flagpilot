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

Open http://localhost:3000. Without a Gemini key the assistant uses an offline demo model that understands the suggested prompts. Data lives in memory and resets when the server restarts.

## License
[MIT](LICENSE)
