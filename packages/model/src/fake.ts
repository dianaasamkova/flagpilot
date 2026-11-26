// A scripted model for tests (ADR-0005). Each call to stream() plays the next turn of
// the script, so a test can say exactly what "the model" does: bad arguments, a
// refusal, a cut-off answer, or hanging until the turn deadline.
import type { ModelClient, ModelEvent, ModelRequest } from "./types.ts";

/**
 * One model call:
 * - a list of events to emit;
 * - "hang": never answer, until the request is aborted;
 * - "throw": fail like a network error.
 */
export type FakeTurn = readonly ModelEvent[] | "hang" | "throw";

export class FakeModelClient implements ModelClient {
  /** Every request the loop sent, so tests can check what the model was shown. */
  readonly requests: ModelRequest[] = [];
  private readonly script: readonly FakeTurn[];
  private next = 0;

  constructor(script: readonly FakeTurn[]) {
    this.script = script;
  }

  async *stream(request: ModelRequest): AsyncGenerator<ModelEvent> {
    // Copy the messages: the loop keeps appending to its own list
    this.requests.push({ ...request, messages: [...request.messages] });
    const turn = this.script[this.next];
    this.next += 1;

    if (turn === undefined) throw new Error(`FakeModelClient: no turn ${this.next} in the script`);
    if (turn === "throw") throw new Error("FakeModelClient: network error");
    if (turn === "hang") {
      await waitForAbort(request.signal);
      return;
    }
    for (const event of turn) {
      if (request.signal.aborted) throw request.signal.reason;
      yield event;
    }
  }
}

/** Resolves never; rejects with the abort reason once the signal aborts. */
function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/** Builds the events of one turn: optional text, then tool calls or a plain end. */
export function fakeTurn(parts: { text?: string; calls?: ModelEvent[] }): ModelEvent[] {
  const events: ModelEvent[] = [];
  if (parts.text) events.push({ type: "text_delta", text: parts.text });
  events.push(...(parts.calls ?? []));
  const reason = parts.calls?.length ? "tool_calls" : "end";
  events.push({ type: "finish", reason });
  return events;
}

/** A tool_call event. */
export function toolCall(id: string, name: string, args: unknown): ModelEvent {
  return { type: "tool_call", call: { id, name, args } };
}
