// Gemini-only tests: how our history and tools become a Gemini request, and the edge cases
// of the response that the shared contract suite doesn't cover.
import { readFileSync } from "node:fs";
import { ApiError, type GenerateContentParameters } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GEMINI_MODEL,
  GeminiModelClient,
  toContents,
  toGeminiRequest,
  type GenerateStream,
} from "../src/gemini.ts";
import type { Message, ToolDefinition } from "../src/index.ts";
import { collect, request } from "./contract.ts";
import { FIXTURES_DIR, fixtureNames, playChunks } from "./gemini-fixtures.ts";

const history: Message[] = [
  { role: "user", text: "Which flags are on in staging?" },
  {
    role: "assistant",
    text: "Let me look.",
    toolCalls: [
      { id: "fc-1", name: "list_flags", args: { env: "staging" }, signature: "sig-1" },
      { id: "fc-2", name: "get_flag", args: { key: "checkout-one-page" } },
    ],
  },
  {
    role: "tool",
    results: [
      { callId: "fc-1", name: "list_flags", isError: false, content: '[{"key":"a-b"}]' },
      { callId: "fc-2", name: "get_flag", isError: true, content: "No flag" },
    ],
  },
];

describe("toContents", () => {
  it("maps text, tool calls with their signature, and tool results", () => {
    expect(toContents(history)).toEqual([
      { role: "user", parts: [{ text: "Which flags are on in staging?" }] },
      {
        role: "model",
        parts: [
          { text: "Let me look." },
          {
            functionCall: { id: "fc-1", name: "list_flags", args: { env: "staging" } },
            thoughtSignature: "sig-1",
          },
          { functionCall: { id: "fc-2", name: "get_flag", args: { key: "checkout-one-page" } } },
        ],
      },
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              id: "fc-1",
              name: "list_flags",
              response: { output: '[{"key":"a-b"}]' },
            },
          },
          { functionResponse: { id: "fc-2", name: "get_flag", response: { error: "No flag" } } },
        ],
      },
    ]);
  });

  it("skips an empty assistant message and merges messages with the same role", () => {
    expect(
      toContents([
        { role: "user", text: "first" },
        { role: "assistant", text: "", toolCalls: [] },
        { role: "user", text: "second" },
      ]),
    ).toEqual([{ role: "user", parts: [{ text: "first" }, { text: "second" }] }]);
  });

  it("never sends an id the adapter made up", () => {
    const [, model] = toContents([
      { role: "user", text: "hi" },
      {
        role: "assistant",
        text: "",
        toolCalls: [{ id: "gemini-local-123", name: "list_flags", args: {} }],
      },
    ]);
    expect(model?.parts).toEqual([{ functionCall: { name: "list_flags", args: {} } }]);
  });
});

describe("toGeminiRequest", () => {
  const tool: ToolDefinition = {
    name: "get_flag",
    description: "Get one flag.",
    inputSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    },
  };

  it("sends the system prompt, the tools without $schema, low thinking and the abort signal", () => {
    const controller = new AbortController();
    const params = toGeminiRequest("gemini-test", 2048, {
      system: "You are FlagPilot.",
      messages: [{ role: "user", text: "hi" }],
      tools: [tool],
      signal: controller.signal,
    });
    expect(params).toEqual({
      model: "gemini-test",
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      config: {
        systemInstruction: "You are FlagPilot.",
        tools: [
          {
            functionDeclarations: [
              {
                name: "get_flag",
                description: "Get one flag.",
                parametersJsonSchema: {
                  type: "object",
                  properties: { key: { type: "string" } },
                  required: ["key"],
                },
              },
            ],
          },
        ],
        thinkingConfig: { thinkingLevel: "LOW" },
        maxOutputTokens: 2048,
        abortSignal: controller.signal,
      },
    });
    // The tool definition itself is left untouched
    expect(tool.inputSchema.$schema).toBeDefined();
  });

  it("leaves tools out when there are none", () => {
    expect(toGeminiRequest("m", 10, request()).config).not.toHaveProperty("tools");
  });
});

describe("GeminiModelClient", () => {
  /** A client whose generate() records the request and plays these chunks. */
  function clientWith(chunks: unknown[]) {
    const sent: GenerateContentParameters[] = [];
    const play = playChunks({ source: "test", chunks });
    const generate: GenerateStream = (params) => {
      sent.push(params);
      return play(params);
    };
    return { client: new GeminiModelClient({ apiKey: "unused", generate }), sent };
  }
  const chunk = (parts: unknown[], finishReason?: string) => ({
    candidates: [{ content: { role: "model", parts }, ...(finishReason && { finishReason }) }],
  });

  it("uses the default model and sends our history", async () => {
    const { client, sent } = clientWith([chunk([{ text: "ok" }], "STOP")]);
    expect(client.model).toBe(DEFAULT_GEMINI_MODEL);
    await collect(client.stream({ ...request(), messages: history }));
    expect(sent[0]?.model).toBe(DEFAULT_GEMINI_MODEL);
    expect(sent[0]?.contents).toEqual(toContents(history));
  });

  it("drops hidden thoughts and empty text", async () => {
    const { client } = clientWith([
      chunk([
        { text: "secret reasoning", thought: true },
        { text: "", thoughtSignature: "x" },
      ]),
      chunk([{ text: "Answer." }], "STOP"),
    ]);
    expect(await collect(client.stream(request()))).toEqual([
      { type: "text_delta", text: "Answer." },
      { type: "finish", reason: "end" },
    ]);
  });

  it("makes an id when Gemini sends none or repeats one", async () => {
    const { client } = clientWith([
      chunk(
        [
          { functionCall: { name: "get_flag", args: { key: "a-b" } } },
          { functionCall: { id: "same", name: "get_flag", args: { key: "c-d" } } },
          { functionCall: { id: "same", name: "get_flag", args: { key: "e-f" } } },
        ],
        "STOP",
      ),
    ]);
    const events = await collect(client.stream(request()));
    const ids = events.flatMap((event) => (event.type === "tool_call" ? [event.call.id] : []));
    expect(ids[0]).toMatch(/^gemini-local-/);
    expect(ids[1]).toBe("same");
    expect(ids[2]).toMatch(/^gemini-local-/);
  });

  it.each([
    ["a blocked prompt", [{ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }], "refused"],
    ["a recitation stop", [chunk([], "RECITATION")], "refused"],
    ["a malformed function call", [chunk([], "MALFORMED_FUNCTION_CALL")], "error"],
    ["a stream that ends with no finish reason", [chunk([{ text: "Half an" }])], "error"],
  ])("maps %s to finish: %s", async (_name, chunks, reason) => {
    const { client } = clientWith(chunks);
    expect((await collect(client.stream(request()))).at(-1)).toMatchObject({
      type: "finish",
      reason,
    });
  });

  it("turns other API and network errors into finish: error without details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const error of [
      new ApiError({ status: 500, message: "internal details" }),
      new TypeError("fetch failed"),
    ]) {
      const client = new GeminiModelClient({
        apiKey: "unused",
        generate: () => Promise.reject(error),
      });
      const [finish] = await collect(client.stream(request()));
      expect(finish).toMatchObject({ type: "finish", reason: "error", errorKind: "other" });
      expect(JSON.stringify(finish)).not.toContain("details");
    }
    vi.restoreAllMocks();
  });
});

describe("Gemini fixtures", () => {
  it("contain nothing that looks like a Google API key", () => {
    for (const name of fixtureNames()) {
      const text = readFileSync(new URL(`${name}.json`, FIXTURES_DIR), "utf8");
      expect(text, name).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    }
  });
});
