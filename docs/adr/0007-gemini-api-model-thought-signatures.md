# ADR-0007: Gemini API, model and thought signatures

- Status: Accepted
- Date: 2026-11-26
- Amends: ADR-0005 (fills in the Gemini details it left for M3)

## Context
ADR-0005 chose Gemini's free tier behind our own `ModelClient` interface. It left three things for M3: the SDK and API to use, the exact model ID, and the free-tier quota. We checked them on 2026-11-26 against the docs (they moved from ai.google.dev to aistudio.google.com this month) and the type definitions in the SDK package. We found:
- **Two APIs.** The SDK now offers the classic `generateContent` and a new Interactions API. The docs call `generateContent` "legacy" but "fully supported", with no shutdown date, and recommend Interactions for new work. Interactions keeps the conversation on Google's servers, or, in stateless mode, needs every hidden "thought" step sent back.
- **Thought signatures.** Gemini 3 models attach an opaque `thoughtSignature` to the first function call of each reply. The next request must send it back on that same part, or the API answers 400. Google documents a dummy value that skips the check, but "strongly discourages" it.
- **Free-tier limits are no longer published per model.** The rate-limits page only links to each project's own limits in AI Studio. Limits apply per project, not per key, and the daily count resets at midnight Pacific time.

## Decision
1. **SDK:** `@google/genai` **3.6.1**, pinned exactly. It released 8 versions in 3 weeks, so upgrades are their own PR.
2. **API:** `ai.models.generateContentStream`. ADR-0004 says we own the history and only append to it. That maps one to one onto `generateContent`'s `contents`; server-side state would give us two copies of the conversation.
3. **Model:** `gemini-3.8-flash` (newest stable Flash) by default, `gemini-3.5-flash-lite` (newest stable Flash-Lite) as the backup. Both are free for input and output. `GEMINI_MODEL` picks one; when it's empty the server uses `gemini-3.8-flash`. We avoid `gemini-2.5-flash`: it's deprecated and from 2026-12-01 its requests go to 3.5 Flash-Lite.
4. **Thinking:** `thinkingLevel: LOW` (3.8 Flash doesn't support `MINIMAL`), and `maxOutputTokens: 2048`, because thinking tokens count against that limit.
5. **Thought signatures:** `ToolCall` gets an optional `signature?: string`, an opaque token the adapter stores and sends back unchanged. It's a plain string, so the interface still contains no provider types. The loop already stores each call exactly as it arrived, so the loop doesn't change.
6. **Free-tier limits** (read by the author in AI Studio; they can change without notice):

   | Model | Requests per minute | Requests per day | Tokens per minute |
   |---|---|---|---|
   | `gemini-3.8-flash` | _to fill in_ | _to fill in_ | _to fill in_ |
   | `gemini-3.5-flash-lite` | _to fill in_ | _to fill in_ | _to fill in_ |

   One assistant turn is 2–3 model calls, so the eval's 30 cases need about 90 requests. The chosen model needs at least ~100 requests a day, plus demo traffic.

## Consequences
- The adapter is the only place that knows about `generateContent`. If Google announces a shutdown date, we write an Interactions adapter behind the same interface; the trigger is that date.
- Every adapter must return `signature` unchanged. The contract tests check that it reaches the next request.
- Gemini 3.6+ models ignore `temperature`, so the same question can get different answers. The eval (M6) grades behaviour (which tool, which arguments), not exact text.
- Free-tier quota stays outside our control; a 429 is a normal "quota used up" state (ADR-0005, decision 4).

## Alternatives considered
- **The Interactions API:** Google's recommendation for new work. Rejected for now because it either holds the conversation on Google's side or needs hidden thought steps sent back, and it's new and still changing.
- **The dummy signature value** (`skip_thought_signature_validator`): no change to our types, but Google discourages it and it may lower answer quality.
- **Keeping signatures inside the adapter** (a map from call id to signature): the adapter is created per request and the conversation is stored elsewhere, so the map would be lost between requests.
- **`gemini-3.6-flash`:** the previous Flash, also free. No reason to prefer it over 3.8.
