# ADR-0001: The assistant acts only through tool calls

- Status: Accepted
- Date: 2026-11-06
- Amended by: ADR-0005 (model provider is now behind our own interface; Claude-specific details apply only to the optional Anthropic adapter)

## Context
Users write intents in natural language ("enable new-checkout for 10% of EU users in staging"). The assistant has to turn these into precise operations on flags. One option is to ask the model for free text, or for a JSON blob inside its text, and parse that. Another is to use the API's tool-use mechanism, where the model emits typed `tool_use` blocks with arguments that match a declared schema.

## Decision
The assistant affects the system **only** through three tools: `list_flags`, `get_flag` and `propose_flag_change`. Free text is for talking to the user (explanations, clarifying questions, refusals). The server never parses free text into an operation.

## Consequences
- **Parseable by construction:** a `tool_use` block arrives as structured data with a name and an input object. We never regex prose.
- **Auditable:** every action is a discrete event with a name and arguments. We can log it, test it and evaluate it. The eval compares the expected tool and args against the actual ones.
- **Least privilege by tool surface:** the model can only do what a tool exists for. There is no "apply" tool, which enforces ADR-0002 structurally.
- **Read before write:** the model can look up real flag keys (`list_flags`) instead of guessing them. This reduces made-up keys.
- Cost: more round-trips per turn (read, then propose) and an agent loop we have to own (ADR-0004).
- On `claude-opus-5-5` we can't *force* a tool (`tool_choice` `any`/`tool` returns a 400). Choosing when to call a tool is steered by the prompt and measured by the eval.

## Alternatives considered
- **JSON in the text response:** fragile to parse, with no schema contract at the API level, and it mixes "talking" with "acting".
- **Structured outputs (`output_config.format`) for one fixed response shape:** good for single-shot extraction. It fits a multi-step read → propose loop poorly, and it doesn't express "maybe ask a question instead".
