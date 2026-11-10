# ADR-0003: One set of zod schemas in `packages/domain` is the contract

- Status: Accepted
- Date: 2026-11-06
- Amended by: ADR-0005 (model provider is now behind our own interface; Claude-specific details apply only to the optional Anthropic adapter)

## Context
The same shapes cross several boundaries: the model's tool inputs, the Next.js route handlers, the streamed events to the browser, the DB layer, the MCP server's tool inputs, and the eval cases. If each boundary defines its own types, they drift apart, and the model, UI and MCP server stop agreeing about what a valid change is.

## Decision
`packages/domain` owns **zod schemas** (and the types inferred from them with `z.infer`) for `FlagKey`, `Environment`, `EnvConfig`, `Targeting`, `FlagChange`, the tool inputs, the `AssistantEvent` stream union and `EvalCase`. Every consumer imports them:
- **Tool definitions for Claude:** JSON Schema is generated from the zod schema, so both sides describe the same thing.
- **Before running any tool:** `schema.safeParse(input)`. A failure goes to the retry loop (M5).
- **MCP server:** the same input schemas register its tools.
- **Browser:** parses each NDJSON event with `AssistantEvent`.

The domain package has **no I/O dependencies** (no Prisma, no SDK), so the browser can import it.

### Why zod still matters with `strict: true`
Strict tool use guarantees the input matches the *JSON Schema* structurally. Our rules go further than JSON Schema can express or than the model can know:
- refinements: `rolloutPercent` is an integer from 0 to 100, region arrays have no duplicates, and the change can't be empty;
- cross-field rules: `rolloutPercent > 0` requires `enabled: true`;
- facts only the server knows: the flag key exists, and the user may write to that environment.

So the split is **strict = shape, zod = meaning**. The retry loop exists for meaning-level errors.

## Consequences
- One change to a schema propagates everywhere, and TypeScript flags the places that break.
- Error messages from zod are what we send back to the model on retry, so they must be **readable by a model** (clear paths and messages). That is a design constraint on how we write refinements.
- Risk: the zod → JSON Schema conversion and zod version compatibility with the MCP SDK must be checked during M1 scaffolding, before we rely on them.

## Alternatives considered
- **Hand-written JSON Schema for tools plus separate TS types:** they drift apart.
- **Trust strict mode alone:** it covers structure only (see above).
- **Prisma-generated types as the source of truth:** they couple the API contract to storage, and the browser can't import them.
