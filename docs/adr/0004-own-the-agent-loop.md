# ADR-0004: Hand-write the agent loop and the stream protocol

- Status: Accepted
- Date: 2026-11-06
- Amended by: ADR-0005 (model provider is now behind our own interface; Claude-specific details apply only to the optional Anthropic adapter)

## Context
The Anthropic SDK offers a Tool Runner (`betaZodTool` plus `toolRunner`) that drives the call → execute → loop cycle. Frameworks such as the Vercel AI SDK also provide a chat stream protocol and React hooks. Both would save code. Our requirements, though, *are* the loop: validate before execution, a bounded retry on validation errors with a deliberate fallback, a turn deadline, abort on client disconnect, refusal and `max_tokens` handling, and a proposal event that the UI renders as a component.

## Decision
- **Manual loop** in `apps/web` on `client.messages.stream(...)`: stream text deltas to the client, collect `tool_use` blocks, validate with zod, run tools, then append **all** `tool_result` blocks in a single user message and loop. History is **append-only**: the model's assistant content goes back unchanged, and a failed call gets an `is_error: true` result rather than being deleted.
- **Our own NDJSON event protocol** (`text_delta`, `tool_started`, `tool_result`, `proposal`, `error`, `done`), typed by `AssistantEvent` in `packages/domain`.
- The loop is a pure-ish function with an injected model client, so Vitest can drive it with a **fake model** that returns scripted bad args, refusals and truncated streams.

## Consequences
- More code, but every line is explainable, and the retry loop is the part you write yourself in M5.
- Failure modes can be unit tested without network or API cost.
- We take on the protocol details ourselves: a missing `done` event means the stream was interrupted, and we keep the event schema compatible as it changes.

## Alternatives considered
- **SDK Tool Runner:** a good default in production. Here it hides the exact control flow we want to own and test, and its hooks would end up holding most of the logic anyway.
- **Vercel AI SDK:** a good developer experience, but it adds another abstraction to explain in interviews and a second tool-schema layer next to our zod schemas.
