// A rule-based stand-in for a real model, so the app works locally and in the demo
// before the Gemini adapter exists (M3). It understands a few fixed request shapes
// and drives the same tools a real model would, through the same ModelClient interface.
import type { Message, ModelClient, ModelEvent, ModelRequest, ToolResult } from "./types.ts";

/** Requests the demo model understands. The UI shows them as suggestion buttons. */
export const DEMO_PROMPTS = [
  "Which flags are on in production?",
  "Turn on search-semantic-ranking in staging",
  "Set checkout-one-page to 80% in staging",
  "Show the history of checkout-one-page",
  "Turn on checkout-one-page in production",
] as const;

const ENV = "(dev|staging|production)";
const KEY = "([a-z][a-z0-9-]*)";

/** The tool call for a user request, or null when the request isn't understood. */
export function planToolCall(text: string): { name: string; args: unknown } | null {
  const input = text.trim().toLowerCase();
  let match = new RegExp(`(?:turn|switch) (on|off) ${KEY} in ${ENV}`).exec(input);
  if (match) {
    const [, onOff, flagKey, env] = match;
    return {
      name: "propose_flag_change",
      args: { flagKey, env, set: { enabled: onOff === "on" }, reason: text.trim() },
    };
  }
  match = new RegExp(`(?:set|roll out) ${KEY} to (\\d+) ?% in ${ENV}`).exec(input);
  if (match) {
    const [, flagKey, percent, env] = match;
    return {
      name: "propose_flag_change",
      args: { flagKey, env, set: { rolloutPercent: Number(percent) }, reason: text.trim() },
    };
  }
  match = new RegExp(`history (?:of|for) ${KEY}`).exec(input);
  if (match) return { name: "explain_flag_history", args: { key: match[1], limit: 5 } };

  if (/\bflags?\b/.test(input)) {
    const env = new RegExp(ENV).exec(input)?.[1];
    const state = /\b(on|enabled)\b/.test(input)
      ? true
      : /\b(off|disabled)\b/.test(input)
        ? false
        : undefined;
    return {
      name: "list_flags",
      args: { ...(env && { env }), ...(env && state !== undefined && { enabled: state }) },
    };
  }
  return null;
}

/** A short reply about a tool result, like a real model would write. */
export function describeResult(result: ToolResult): string {
  if (result.isError) return `That didn't work: ${result.content}`;
  const data: unknown = JSON.parse(result.content);
  switch (result.name) {
    case "list_flags": {
      const keys = (data as { key: string }[]).map((flag) => flag.key);
      return keys.length === 0
        ? "No flags match."
        : `I found ${keys.length} flag${keys.length === 1 ? "" : "s"}: ${keys.join(", ")}.`;
    }
    case "explain_flag_history": {
      const events = data as { at: string; reason: string; env: string }[];
      if (events.length === 0) return "This flag has no recorded changes yet.";
      const lines = events.map(
        (event) => `- ${event.at.slice(0, 10)} (${event.env}): ${event.reason}`,
      );
      return `Latest changes, newest first:\n${lines.join("\n")}`;
    }
    case "propose_flag_change":
      return "I've prepared the change. Nothing has changed yet: review the card and click Confirm to apply it.";
    default:
      return "Done.";
  }
}

function lastUserText(messages: readonly Message[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return message.text;
  }
  return "";
}

export class DemoModelClient implements ModelClient {
  async *stream(request: ModelRequest): AsyncGenerator<ModelEvent> {
    const last = request.messages.at(-1);

    // After a tool ran: describe its result and finish the turn
    if (last?.role === "tool") {
      const text = last.results.map(describeResult).join("\n\n");
      yield { type: "text_delta", text };
      yield { type: "finish", reason: "end" };
      return;
    }

    const call = planToolCall(lastUserText(request.messages));
    if (call === null) {
      yield {
        type: "text_delta",
        text: `I'm the offline demo model, so I only understand a few requests. Try one of these:\n${DEMO_PROMPTS.map((prompt) => `- ${prompt}`).join("\n")}`,
      };
      yield { type: "finish", reason: "end" };
      return;
    }
    // Ids must be unique across the whole conversation, not just this request
    yield { type: "tool_call", call: { id: `demo-${crypto.randomUUID()}`, ...call } };
    yield { type: "finish", reason: "tool_calls" };
  }
}
