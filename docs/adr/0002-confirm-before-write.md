# ADR-0002: The model proposes; a human confirms; the server applies

- Status: Accepted
- Date: 2026-11-06

## Context
Flag changes affect production behaviour for real users. Model output is probabilistic: it can misread "10%" or "EU", or pick the wrong environment. Prompt injection could also come from data the model reads, such as flag descriptions. A wrong write is expensive. An extra click is cheap.

## Decision
1. `propose_flag_change` **never writes a flag**. It validates input, checks that the current user *could* make the change, computes a diff, and stores a `Proposal` (`baseRevision`, `before`, `after`, `createdBy`, `expiresAt`, `status: pending`). It returns the proposal to the model and streams it to the UI.
2. The UI renders the proposal as a **ProposalCard** (a real component with a field-level diff, not model prose) with Confirm / Discard.
3. Confirm is a plain `POST /api/proposals/:id/confirm` that the human's click triggers. It is not a tool. It **re-checks** on the server:
   - the session user is the proposal's creator and still has write permission for that environment;
   - the proposal is `pending` and not expired;
   - the flag's current `revision === baseRevision` (optimistic concurrency). Otherwise it returns 409 "flag changed since proposal".
4. Applying the change and appending a `FlagEvent` happen in one DB transaction.

## Consequences
- The model's worst case is a **bad suggestion**, never a bad write.
- Permission checks happen twice (at propose for fast feedback, at confirm as the real gate), because things can change between the two (TOCTOU).
- The diff the user sees comes from the stored proposal, not from what the model *says* it did. If the text and the card disagree, the card is the truth.
- Cost: a proposals table, an expiry policy, and a stale-proposal (409) UI state.

## Alternatives considered
- **An `apply_flag_change` tool behind a "are you sure?" chat message:** the confirmation would live in the conversation, where the model or injected text could fake it.
- **Auto-apply in dev only:** tempting, but then the eval and UI would have two code paths. We may revisit it after M6.
