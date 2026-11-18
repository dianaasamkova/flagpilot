import { describe, expect, it } from "vitest";
import { decodeEvent, encodeEvent, type AssistantEvent } from "../src/index.ts";

const events: AssistantEvent[] = [
  { type: "text_delta", text: "Looking" },
  { type: "tool_started", id: "c1", name: "list_flags" },
  { type: "tool_result", id: "c1", name: "list_flags", ok: true },
  {
    type: "proposal",
    proposal: {
      id: "p-1",
      flagKey: "checkout-one-page",
      env: "staging",
      reason: "Widen the beta",
      baseRevision: 4,
      before: { enabled: true, targeting: { regions: ["EU"] }, rolloutPercent: 10 },
      after: { enabled: true, targeting: { regions: ["EU"] }, rolloutPercent: 50 },
      createdBy: "u-editor",
      createdAt: "2026-11-18T10:00:00.000Z",
      expiresAt: "2026-11-18T10:15:00.000Z",
      status: "pending",
    },
  },
  { type: "error", code: "timeout", message: "That took too long." },
  { type: "done" },
];

describe("AssistantEvent NDJSON", () => {
  it.each(events.map((event) => [event.type, event] as const))(
    "%s survives encode → decode",
    (_type, event) => {
      const line = encodeEvent(event);
      expect(line.endsWith("\n")).toBe(true);
      expect(line.slice(0, -1)).not.toContain("\n");
      expect(decodeEvent(line)).toEqual(event);
    },
  );

  it.each([
    ["not JSON", "{oops"],
    ["an unknown type", '{"type":"apply_change"}'],
    ["an unknown tool", '{"type":"tool_started","id":"c1","name":"delete_flag"}'],
    ["an extra field", '{"type":"done","secret":1}'],
  ])("rejects %s", (_case, line) => {
    expect(decodeEvent(line)).toBeNull();
  });
});
