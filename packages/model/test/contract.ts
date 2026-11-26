// The ModelClient contract (FP-19, ADR-0005): what every adapter must do so the agent loop
// can't tell them apart. Each adapter test file runs this suite with its own way of
// producing each scenario: a script for the fake, recorded chunks for Gemini.
import { describe, expect, it } from "vitest";
import type { FinishReason, ModelClient, ModelEvent, ModelRequest } from "../src/index.ts";

type Expectation = {
  /** Names of the tool calls, in order. */
  calls: string[];
  finish: FinishReason;
  errorKind?: "quota" | "other";
  /** The reply must contain text. */
  text?: boolean;
  /** The first call must carry a provider signature (ADR-0007). */
  firstCallSigned?: boolean;
};

export const SCENARIOS = {
  plain: { calls: [], finish: "end", text: true },
  tool_call: { calls: ["list_flags"], finish: "tool_calls", firstCallSigned: true },
  parallel_calls: { calls: ["get_flag", "get_flag"], finish: "tool_calls", firstCallSigned: true },
  max_tokens: { calls: [], finish: "max_tokens" },
  refused: { calls: [], finish: "refused" },
  quota: { calls: [], finish: "error", errorKind: "quota" },
} satisfies Record<string, Expectation>;

export type Scenario = keyof typeof SCENARIOS;

export type ContractSubject = {
  /** A client that plays this scenario on its next stream() call. */
  clientFor(scenario: Scenario): ModelClient;
  /** A client that starts answering, then waits until the request is aborted. */
  hangingClient(): ModelClient;
};

export function request(signal = new AbortController().signal): ModelRequest {
  return { system: "test", messages: [{ role: "user", text: "hi" }], tools: [], signal };
}

export async function collect(stream: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

/** Rules every stream must follow, whatever the scenario. */
function expectWellFormed(events: ModelEvent[]): void {
  const finishes = events.filter((event) => event.type === "finish");
  expect(finishes, "exactly one finish event").toHaveLength(1);
  expect(events.at(-1)?.type, "finish is the last event").toBe("finish");

  const ids = events.flatMap((event) => (event.type === "tool_call" ? [event.call.id] : []));
  for (const id of ids) expect(id, "every tool call has an id").not.toBe("");
  expect(new Set(ids).size, "tool call ids are unique").toBe(ids.length);

  for (const event of events) {
    if (event.type === "text_delta") expect(event.text, "no empty text deltas").not.toBe("");
  }
}

export function describeModelClientContract(name: string, subject: ContractSubject): void {
  describe(`ModelClient contract: ${name}`, () => {
    it.each(Object.keys(SCENARIOS) as Scenario[])("%s", async (scenario) => {
      const expected: Expectation = SCENARIOS[scenario];
      const events = await collect(subject.clientFor(scenario).stream(request()));
      expectWellFormed(events);

      const calls = events.flatMap((event) => (event.type === "tool_call" ? [event.call] : []));
      expect(calls.map((call) => call.name)).toEqual(expected.calls);
      if (expected.firstCallSigned) expect(calls[0]?.signature).toEqual(expect.any(String));
      if (expected.text) expect(events.some((event) => event.type === "text_delta")).toBe(true);

      const finish = events.at(-1);
      expect(finish).toMatchObject({
        type: "finish",
        reason: expected.finish,
        ...(expected.errorKind && { errorKind: expected.errorKind }),
      });
    });

    it("rejects with the abort reason when the request is aborted", async () => {
      const controller = new AbortController();
      const pending = collect(subject.hangingClient().stream(request(controller.signal)));
      const reason = new Error("turn deadline");
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
    });
  });
}
