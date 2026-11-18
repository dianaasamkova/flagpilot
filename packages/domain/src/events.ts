// The events the server streams to the browser, one JSON object per line (NDJSON),
// as ADR-0004 describes (FP-18). The browser parses every line with AssistantEvent,
// so a server bug can't put an unknown shape on the screen.
import { z } from "zod";
import { Proposal } from "./proposal.ts";
import { TOOL_INPUTS, type ToolName } from "./tools.ts";

export const ToolNameSchema = z.enum(Object.keys(TOOL_INPUTS) as [ToolName, ...ToolName[]]);

/** Why a turn ended badly. Each code gets its own UI state (M5). */
export const ASSISTANT_ERROR_CODES = [
  "invalid_tool_args", // the model kept sending bad tool input (after the retries)
  "max_iterations", // too many model calls in one turn
  "timeout", // the turn took longer than the deadline
  "max_tokens", // the model's answer was cut off by its length limit
  "refused", // the model's safety system refused to answer
  "quota", // the free-tier quota ran out
  "model_error", // any other model or network failure
] as const;
export const AssistantErrorCode = z.enum(ASSISTANT_ERROR_CODES);
export type AssistantErrorCode = z.infer<typeof AssistantErrorCode>;

export const AssistantEvent = z.discriminatedUnion("type", [
  // A piece of the assistant's reply text
  z.strictObject({ type: z.literal("text_delta"), text: z.string() }),
  // A tool started running (the UI can show "Looking up flags…")
  z.strictObject({ type: z.literal("tool_started"), id: z.string(), name: ToolNameSchema }),
  // A tool finished; ok is false when its input was invalid or it returned an error
  z.strictObject({
    type: z.literal("tool_result"),
    id: z.string(),
    name: ToolNameSchema,
    ok: z.boolean(),
  }),
  // A stored proposal for the ProposalCard. The card renders this, never the model's text.
  z.strictObject({ type: z.literal("proposal"), proposal: Proposal }),
  z.strictObject({
    type: z.literal("error"),
    code: AssistantErrorCode,
    message: z.string(),
  }),
  // Always the last event. A stream that ends without it was interrupted.
  z.strictObject({ type: z.literal("done") }),
]);
export type AssistantEvent = z.infer<typeof AssistantEvent>;

/** One NDJSON line for an event. */
export function encodeEvent(event: AssistantEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/** Parses one NDJSON line. Returns null for a line that isn't a valid event. */
export function decodeEvent(line: string): AssistantEvent | null {
  try {
    const result = AssistantEvent.safeParse(JSON.parse(line));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
