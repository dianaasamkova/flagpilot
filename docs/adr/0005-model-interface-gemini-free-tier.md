# ADR-0005: A provider-neutral model interface, with Gemini's free tier as the default

- Status: Accepted
- Date: 2026-11-06
- Amends: ADR-0001 (tool-choice note), ADR-0003 (`strict: true` section), ADR-0004 (SDK call in the loop)

## Context
The project is public and **must run at zero cost** (PLAN, decision 5). Anyone should be able to try the hosted demo without the owner paying per message. The Anthropic API has no free tier. The Gemini API (Google AI Studio) has a free tier for its Flash and Flash-Lite models, including in the EU/EEA, UK and Switzerland (checked 2026-11-06). Its terms differ from paid use in two ways:
- Google uses free-tier content to improve its products.
- Rate limits are set per project, shown only in AI Studio, and can change without notice.

ADR-0004 already puts the agent loop behind an injected model client so tests can use a fake model.

## Decision
1. **`ModelClient` is our own interface**, defined with our own types: messages, tool definitions generated from the zod schemas, tool calls, and a stream of normalized events (`text_delta`, `tool_call`, `finish` with a reason of `end` / `tool_calls` / `max_tokens` / `refused` / `error`). The agent loop knows only this interface. No provider types leak past an adapter.
2. **Adapters:**

   | Adapter | Used for | Cost |
   |---|---|---|
   | `FakeModelClient` | Unit tests; scripted bad arguments, refusals, cut-off streams | Free |
   | `ReplayModelClient` | Default public demo mode; plays back recorded real responses | Free |
   | `GeminiModelClient` | Live demo mode, local development, eval | Free tier |
   | `AnthropicModelClient` | Optional, after M6; only active if `ANTHROPIC_API_KEY` is set | Paid, never required |

3. **The adapter is chosen by configuration on the server** (`MODEL_PROVIDER`, `GEMINI_MODEL`). The Gemini model ID is not hard-coded. At M3 we pick a free-tier Flash model after checking its quota in AI Studio.
4. **Running out of quota is a normal state, not an error.** When Gemini returns a rate-limit error, the route switches that conversation to `ReplayModelClient` and the UI says so.
5. **Data-use notice:** the live mode's UI states that input goes to a free-tier model and must not contain personal data. All demo data is invented.

## Consequences
- **Zero running cost** on every default path. A paid key is optional for anyone who wants to compare models.
- **zod becomes even more central.** Each provider accepts its own schema format and only part of JSON Schema. The zod schema is the single source; each adapter converts it, and zod validates every tool input regardless of provider. Claude's `strict: true` (ADR-0003) is now an optional Anthropic-adapter detail, not something we rely on.
- **Provider-specific behaviour moves into adapters.** That includes Claude's forced tool choice returning a 400 (ADR-0001), refusal `stop_reason`s, and how each SDK streams tool-call arguments. Each adapter gets contract tests that check it produces the same normalized events.
- **A better interview story:** "the loop has no provider in it; adapters translate" is a common senior-level question.
- **Costs:**
  - one more abstraction layer to explain;
  - the free tier's limits are not under our control, so the demo must handle them gracefully;
  - free-tier quality and speed may be below paid models, and the eval will show by how much;
  - the Gemini SDK details (package `@google/genai`, function-calling and streaming shapes) must be checked against current docs at M3, before we write the adapter.
- Part 2 (the MCP server in Claude Code) is unaffected and runs on the owner's Claude plan.

## Alternatives considered
- **Anthropic only, with replay mode plus capped Haiku 5.5:** very cheap, but not zero. It breaks decision 5.
- **Gemini only, with no interface:** the least code, but it ties the loop to one SDK and makes the fake and replay clients awkward.
- **Visitors bring their own API key:** keeps the owner's cost at zero, but most visitors have no key, and the key would pass through the browser, which works against ADR-0004's server-only rule.
- **A local model with Ollama:** free, but it can't serve a hosted demo. It could be a later adapter for offline development.
