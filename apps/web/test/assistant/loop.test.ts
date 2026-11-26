import { DEMO_USERS, MemoryFlagStore, seedEvents, seedFlags } from "@flagpilot/db";
import { AssistantEvent, type User } from "@flagpilot/domain";
import {
  FakeModelClient,
  fakeTurn,
  toolCall,
  type FakeTurn,
  type Message,
  type ModelEvent,
} from "@flagpilot/model";
import { describe, expect, it, vi } from "vitest";
import { FALLBACK_MESSAGE, runAssistantTurn, type TurnLimits } from "../../lib/assistant/loop.ts";
import { createToolHandlers } from "../../lib/assistant/tools.ts";

const [viewer, editor] = DEMO_USERS as [User, User, User];

const validChange = {
  flagKey: "checkout-one-page",
  env: "staging",
  set: { rolloutPercent: 80 },
  reason: "Widen the beta",
};
const badChange = { ...validChange, set: { rolloutPercent: 150 } };

/** Runs one turn against a fresh seeded store and a scripted model. */
async function run(
  script: FakeTurn[],
  options: { user?: User; limits?: Partial<TurnLimits>; signal?: AbortSignal } = {},
) {
  const user = options.user ?? editor;
  const store = new MemoryFlagStore({ flags: seedFlags(), events: seedEvents() });
  const model = new FakeModelClient(script);
  const messages: Message[] = [];
  const events: AssistantEvent[] = [];
  for await (const event of runAssistantTurn({
    model,
    user,
    tools: createToolHandlers(store, user),
    messages,
    userText: "please help",
    ...(options.limits && { limits: options.limits }),
    ...(options.signal && { signal: options.signal }),
  })) {
    // Every event must pass the schema the browser uses
    expect(AssistantEvent.safeParse(event).success).toBe(true);
    events.push(event);
  }
  return { events, model, store, messages, types: events.map((event) => event.type) };
}

/** The last message the model was sent on its nth call (0-based). */
function lastSent(model: FakeModelClient, call: number): Message | undefined {
  return model.requests[call]?.messages.at(-1);
}

describe("runAssistantTurn: normal turns", () => {
  it("streams a plain answer and ends with done", async () => {
    const { events, messages } = await run([fakeTurn({ text: "Hello!" })]);
    expect(events).toEqual([{ type: "text_delta", text: "Hello!" }, { type: "done" }]);
    expect(messages).toEqual([
      { role: "user", text: "please help" },
      { role: "assistant", text: "Hello!", toolCalls: [] },
    ]);
  });

  it("runs a read tool, sends the result back, then answers", async () => {
    const { types, model } = await run([
      fakeTurn({ calls: [toolCall("c1", "list_flags", { env: "staging", enabled: true })] }),
      fakeTurn({ text: "Here they are." }),
    ]);
    expect(types).toEqual(["tool_started", "tool_result", "text_delta", "done"]);
    const sent = lastSent(model, 1);
    expect(sent?.role).toBe("tool");
    if (sent?.role === "tool") {
      expect(sent.results[0]).toMatchObject({ callId: "c1", isError: false });
      expect(sent.results[0]?.content).toContain("checkout-one-page");
    }
  });

  it("sends a tool call's signature back to the model unchanged (ADR-0007)", async () => {
    const { model } = await run([
      fakeTurn({ calls: [toolCall("c1", "list_flags", {}, "opaque-signature-1")] }),
      fakeTurn({ text: "Here they are." }),
    ]);
    // The second request's history holds the assistant message exactly as the model sent it
    const reply = model.requests[1]?.messages.find((message) => message.role === "assistant");
    expect(reply).toEqual({
      role: "assistant",
      text: "",
      toolCalls: [{ id: "c1", name: "list_flags", args: {}, signature: "opaque-signature-1" }],
    });
  });

  it("streams a proposal event and leaves the flag unchanged", async () => {
    const { events, store } = await run([
      fakeTurn({ calls: [toolCall("c1", "propose_flag_change", validChange)] }),
      fakeTurn({ text: "Review the card." }),
    ]);
    const proposal = events.find((event) => event.type === "proposal");
    expect(proposal).toMatchObject({
      proposal: { flagKey: "checkout-one-page", status: "pending" },
    });
    expect((await store.getFlag("checkout-one-page"))?.envs.staging.rolloutPercent).toBe(50);
  });

  it("gives every system prompt the user's role", async () => {
    const { model } = await run([fakeTurn({ text: "Hi" })], { user: viewer });
    expect(model.requests[0]?.system).toContain("role: viewer");
    expect(model.requests[0]?.tools.map((tool) => tool.name)).toEqual([
      "list_flags",
      "get_flag",
      "propose_flag_change",
      "explain_flag_history",
    ]);
  });
});

describe("runAssistantTurn: validation and retry (FP-27)", () => {
  it("bad → good: the model gets the zod error and its second try works", async () => {
    const { events, model } = await run([
      fakeTurn({ calls: [toolCall("c1", "propose_flag_change", badChange)] }),
      fakeTurn({ calls: [toolCall("c2", "propose_flag_change", validChange)] }),
      fakeTurn({ text: "Ready to review." }),
    ]);

    const sent = lastSent(model, 1);
    expect(sent?.role === "tool" && sent.results[0]).toMatchObject({ isError: true });
    expect(sent?.role === "tool" && sent.results[0]?.content).toContain("from 0 to 100");

    expect(events.filter((event) => event.type === "proposal")).toHaveLength(1);
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("bad → bad → bad: stops after 2 retries with the fallback message", async () => {
    const bad = () => fakeTurn({ calls: [toolCall("c", "propose_flag_change", badChange)] });
    const { events, model } = await run([bad(), bad(), bad(), fakeTurn({ text: "never" })]);
    expect(model.requests).toHaveLength(3);
    expect(events.slice(-2)).toEqual([
      { type: "error", code: "invalid_tool_args", message: FALLBACK_MESSAGE },
      { type: "done" },
    ]);
  });

  it("only counts invalid turns in a row: a valid turn resets the count", async () => {
    const bad = () => fakeTurn({ calls: [toolCall("c", "propose_flag_change", badChange)] });
    const good = fakeTurn({ calls: [toolCall("g", "list_flags", {})] });
    const { events } = await run([bad(), bad(), good, bad(), fakeTurn({ text: "Done" })]);
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("treats an unknown tool as invalid input and hides it from the browser", async () => {
    const { types, model } = await run([
      fakeTurn({ calls: [toolCall("c1", "apply_flag_change", validChange)] }),
      fakeTurn({ text: "I can only propose changes." }),
    ]);
    expect(types).toEqual(["text_delta", "done"]);
    const sent = lastSent(model, 1);
    expect(sent?.role === "tool" && sent.results[0]?.content).toContain("Unknown tool");
  });

  it("a refused change (no permission) isn't a retry: the model explains it", async () => {
    const { events, model } = await run(
      [
        fakeTurn({ calls: [toolCall("c1", "propose_flag_change", validChange)] }),
        fakeTurn({ text: "Viewers can't change flags." }),
      ],
      { user: viewer },
    );
    expect(events.find((event) => event.type === "tool_result")).toMatchObject({ ok: false });
    expect(events.some((event) => event.type === "proposal" || event.type === "error")).toBe(false);
    const sent = lastSent(model, 1);
    expect(sent?.role === "tool" && sent.results[0]?.content).toContain("Editors can change");
  });
});

describe("runAssistantTurn: limits and failures (FP-28, M5)", () => {
  it("stops at the deadline with a timeout error", async () => {
    const { events } = await run(["hang"], { limits: { deadlineMs: 20 } });
    expect(events).toEqual([
      { type: "error", code: "timeout", message: "That took too long. Please try again." },
      { type: "done" },
    ]);
  });

  it("stops quietly when the browser disconnects", async () => {
    const controller = new AbortController();
    controller.abort();
    const { events } = await run(["hang"], { signal: controller.signal });
    expect(events).toEqual([]);
  });

  it("stops a model that keeps calling tools", async () => {
    const again = () => fakeTurn({ calls: [toolCall("c", "list_flags", {})] });
    const { events, model } = await run([again(), again(), again()], {
      limits: { maxIterations: 3 },
    });
    expect(model.requests).toHaveLength(3);
    expect(events.at(-2)).toMatchObject({ type: "error", code: "max_iterations" });
  });

  const finish = (event: Omit<Extract<ModelEvent, { type: "finish" }>, "type">): FakeTurn => [
    { type: "text_delta", text: "Partial" },
    { type: "finish", ...event },
  ];

  it.each([
    ["max_tokens", finish({ reason: "max_tokens" })],
    ["refused", finish({ reason: "refused" })],
    ["quota", finish({ reason: "error", errorKind: "quota" })],
    ["model_error", finish({ reason: "error", errorKind: "other" })],
    ["model_error", [{ type: "text_delta", text: "no finish event" }] satisfies ModelEvent[]],
  ])("turns a %s stop into its error state", async (code, turn) => {
    const { events } = await run([turn]);
    expect(events.at(-2)).toMatchObject({ type: "error", code });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("reports a network failure as model_error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { events } = await run(["throw"]);
    expect(events.at(-2)).toMatchObject({ type: "error", code: "model_error" });
    spy.mockRestore();
  });
});
