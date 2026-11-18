import { describe, expect, it } from "vitest";
import { FakeModelClient, fakeTurn, toolCall, type ModelEvent } from "../src/index.ts";

const request = (signal = new AbortController().signal) => ({
  system: "test",
  messages: [{ role: "user" as const, text: "hi" }],
  tools: [],
  signal,
});

async function collect(stream: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("FakeModelClient", () => {
  it("plays the script one turn per call and records each request", async () => {
    const model = new FakeModelClient([
      fakeTurn({ text: "Let me look.", calls: [toolCall("c1", "list_flags", {})] }),
      fakeTurn({ text: "Done." }),
    ]);

    expect(await collect(model.stream(request()))).toEqual([
      { type: "text_delta", text: "Let me look." },
      { type: "tool_call", call: { id: "c1", name: "list_flags", args: {} } },
      { type: "finish", reason: "tool_calls" },
    ]);
    expect(await collect(model.stream(request()))).toEqual([
      { type: "text_delta", text: "Done." },
      { type: "finish", reason: "end" },
    ]);
    expect(model.requests).toHaveLength(2);
  });

  it("fails clearly when the script runs out", async () => {
    const model = new FakeModelClient([]);
    await expect(collect(model.stream(request()))).rejects.toThrow("no turn 1");
  });

  it('"hang" waits until the request is aborted', async () => {
    const model = new FakeModelClient(["hang"]);
    const controller = new AbortController();
    const pending = collect(model.stream(request(controller.signal)));
    controller.abort(new Error("deadline"));
    await expect(pending).rejects.toThrow("deadline");
  });

  it('"throw" fails like a network error', async () => {
    const model = new FakeModelClient(["throw"]);
    await expect(collect(model.stream(request()))).rejects.toThrow("network error");
  });
});
