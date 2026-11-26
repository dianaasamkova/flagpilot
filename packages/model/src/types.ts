// Our own model interface (ADR-0005, FP-17). The agent loop talks only to these types;
// each adapter (fake, replay, Gemini) translates its provider to them. No provider type
// appears here, so changing provider never touches the loop.

/** A tool the model may call. inputSchema is JSON Schema generated from our zod schemas. */
export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/**
 * A tool call from the model. args is unchecked: the loop validates it with zod.
 * signature is an opaque token some providers attach to a call (Gemini's thought
 * signatures, ADR-0007). It must go back unchanged in the next request; the loop never reads it.
 */
export type ToolCall = { id: string; name: string; args: unknown; signature?: string };

/** What the loop sends back for one tool call. isError tells the model the call failed. */
export type ToolResult = { callId: string; name: string; isError: boolean; content: string };

/** The conversation so far. The loop only appends to it, never edits (ADR-0004). */
export type Message =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[] }
  | { role: "tool"; results: ToolResult[] };

/**
 * Why the model stopped:
 * - end: it finished its answer;
 * - tool_calls: it wants tool results before going on;
 * - max_tokens: the answer hit the length limit and was cut off;
 * - refused: the provider's safety system blocked the answer;
 * - error: something failed (errorKind "quota" when the free-tier quota ran out).
 */
export type FinishReason = "end" | "tool_calls" | "max_tokens" | "refused" | "error";

/** The normalized stream every adapter produces. The last event is always a finish. */
export type ModelEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | {
      type: "finish";
      reason: FinishReason;
      errorKind?: "quota" | "other";
      message?: string;
    };

export type ModelRequest = {
  system: string;
  messages: readonly Message[];
  tools: readonly ToolDefinition[];
  // Aborts the request: on the turn deadline, or when the browser disconnects
  signal: AbortSignal;
};

export interface ModelClient {
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
}
