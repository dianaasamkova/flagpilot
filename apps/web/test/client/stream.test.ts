import { encodeEvent, type AssistantEvent } from "@flagpilot/domain";
import { describe, expect, it } from "vitest";
import { readEventStream } from "../../lib/client/stream.ts";

/** A byte stream that delivers the given string chunks one by one, then ends or fails. */
function streamOf(chunks: string[], failAtEnd = false): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const queue = [...chunks];
  return new ReadableStream({
    pull(controller) {
      const chunk = queue.shift();
      if (chunk !== undefined) controller.enqueue(encoder.encode(chunk));
      else if (failAtEnd) controller.error(new Error("connection reset"));
      else controller.close();
    },
  });
}

async function read(chunks: string[], failAtEnd = false) {
  const events: AssistantEvent[] = [];
  const result = await readEventStream(streamOf(chunks, failAtEnd), (event) => events.push(event));
  return { events, ...result };
}

const text = encodeEvent({ type: "text_delta", text: "Hi" });
const done = encodeEvent({ type: "done" });

describe("readEventStream", () => {
  it("reads every event and reports a completed stream", async () => {
    const result = await read([text, done]);
    expect(result.events.map((event) => event.type)).toEqual(["text_delta", "done"]);
    expect(result.completed).toBe(true);
  });

  it("joins a line split across chunks", async () => {
    const both = text + done;
    const result = await read([both.slice(0, 7), both.slice(7, 30), both.slice(30)]);
    expect(result.events).toHaveLength(2);
  });

  it("reports a stream without done as interrupted", async () => {
    expect((await read([text])).completed).toBe(false);
  });

  it("reports a network error as interrupted, keeping earlier events", async () => {
    const result = await read([text], true);
    expect(result.events).toHaveLength(1);
    expect(result.completed).toBe(false);
  });

  it("skips lines that aren't valid events", async () => {
    const result = await read(['{"type":"apply"}\n', "garbage\n", done]);
    expect(result.events.map((event) => event.type)).toEqual(["done"]);
  });
});
