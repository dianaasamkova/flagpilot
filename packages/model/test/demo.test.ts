import { describe, expect, it } from "vitest";
import {
  DEMO_PROMPTS,
  DemoModelClient,
  describeResult,
  planToolCall,
  type ModelEvent,
} from "../src/index.ts";

describe("planToolCall", () => {
  it.each([
    [
      "Turn on search-semantic-ranking in staging",
      {
        name: "propose_flag_change",
        args: { flagKey: "search-semantic-ranking", env: "staging", set: { enabled: true } },
      },
    ],
    [
      "switch off checkout-one-page in dev",
      {
        name: "propose_flag_change",
        args: { flagKey: "checkout-one-page", env: "dev", set: { enabled: false } },
      },
    ],
    [
      "Set checkout-one-page to 80% in staging",
      {
        name: "propose_flag_change",
        args: { flagKey: "checkout-one-page", env: "staging", set: { rolloutPercent: 80 } },
      },
    ],
    [
      "Show the history of checkout-one-page",
      { name: "explain_flag_history", args: { key: "checkout-one-page", limit: 5 } },
    ],
    [
      "Which flags are on in production?",
      { name: "list_flags", args: { env: "production", enabled: true } },
    ],
    ["list all flags", { name: "list_flags", args: {} }],
  ])("understands %j", (text, expected) => {
    expect(planToolCall(text)).toMatchObject(expected);
  });

  it("keeps the user's words as the reason", () => {
    expect(planToolCall("Turn on search-semantic-ranking in staging")?.args).toMatchObject({
      reason: "Turn on search-semantic-ranking in staging",
    });
  });

  it("returns null for anything else", () => {
    expect(planToolCall("write me a poem")).toBeNull();
  });

  it("understands every suggested prompt", () => {
    for (const prompt of DEMO_PROMPTS) expect(planToolCall(prompt)).not.toBeNull();
  });
});

describe("describeResult", () => {
  it("passes tool errors on to the user", () => {
    expect(
      describeResult({ callId: "c", name: "get_flag", isError: true, content: "No flag" }),
    ).toBe("That didn't work: No flag");
  });

  it("never claims a proposal was applied", () => {
    const text = describeResult({
      callId: "c",
      name: "propose_flag_change",
      isError: false,
      content: "{}",
    });
    expect(text).toContain("Nothing has changed yet");
  });
});

describe("DemoModelClient", () => {
  const collect = async (stream: AsyncIterable<ModelEvent>) => {
    const events: ModelEvent[] = [];
    for await (const event of stream) events.push(event);
    return events;
  };
  const signal = new AbortController().signal;

  it("calls a tool, then describes its result", async () => {
    const model = new DemoModelClient();
    const first = await collect(
      model.stream({
        system: "",
        tools: [],
        signal,
        messages: [{ role: "user", text: "list flags" }],
      }),
    );
    expect(first.at(-1)).toEqual({ type: "finish", reason: "tool_calls" });

    const second = await collect(
      model.stream({
        system: "",
        tools: [],
        signal,
        messages: [
          { role: "user", text: "list flags" },
          {
            role: "tool",
            results: [
              { callId: "demo-1", name: "list_flags", isError: false, content: '[{"key":"a-b"}]' },
            ],
          },
        ],
      }),
    );
    expect(second).toEqual([
      { type: "text_delta", text: "I found 1 flag: a-b." },
      { type: "finish", reason: "end" },
    ]);
  });

  it("suggests prompts when it doesn't understand", async () => {
    const events = await collect(
      new DemoModelClient().stream({
        system: "",
        tools: [],
        signal,
        messages: [{ role: "user", text: "hi" }],
      }),
    );
    expect(events[0]).toMatchObject({
      type: "text_delta",
      text: expect.stringContaining("offline demo model"),
    });
  });
});
