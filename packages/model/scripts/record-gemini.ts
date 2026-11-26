// Records real Gemini responses as test fixtures, and doubles as the live check (FP-19).
// Run: pnpm --filter @flagpilot/model record:gemini   (GEMINI_API_KEY in the repo-root .env)
// It saves only response chunks (candidates, prompt feedback, token counts), never the
// request or its headers, so the key can't end up in a fixture. Uses about 6 requests.
import { writeFile } from "node:fs/promises";
import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import { DEFAULT_GEMINI_MODEL, GeminiModelClient, type GenerateStream } from "../src/gemini.ts";
import type { Message, ModelEvent, ToolDefinition } from "../src/types.ts";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY is empty. Put it in the repo-root .env (never in git).");
  process.exit(1);
}
const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
const ai = new GoogleGenAI({ apiKey });
const fixturesDir = new URL("../test/fixtures/gemini/", import.meta.url);

const SYSTEM =
  "You are the assistant of a feature-flag console. Use the tools to look things up. Keep answers short.";

// Small stand-ins for the app's tools: this package doesn't depend on the domain schemas
const TOOLS: ToolDefinition[] = [
  {
    name: "list_flags",
    description: "Find feature flags, optionally only those on or off in one environment.",
    inputSchema: {
      type: "object",
      properties: {
        env: { type: "string", enum: ["dev", "staging", "production"] },
        enabled: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_flag",
    description: "Get one flag by its exact key.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
      additionalProperties: false,
    },
  },
];

type Recording = {
  name: string;
  messages: Message[];
  tools: ToolDefinition[];
  maxOutputTokens?: number;
};

const RECORDINGS: Recording[] = [
  {
    name: "plain",
    messages: [{ role: "user", text: "In two sentences: what is a feature flag?" }],
    tools: [],
  },
  {
    name: "tool_call",
    messages: [{ role: "user", text: "Which flags are on in staging?" }],
    tools: TOOLS,
  },
  {
    name: "parallel_calls",
    messages: [
      {
        role: "user",
        text: "Get the flags checkout-one-page and search-semantic-ranking. Fetch both at once.",
      },
    ],
    tools: TOOLS,
  },
  {
    name: "max_tokens",
    messages: [{ role: "user", text: "Explain feature flags in detail, with examples." }],
    tools: [],
    maxOutputTokens: 60,
  },
];

/** Only the parts of a chunk the adapter reads, plus token counts for later cost estimates. */
function keep(chunk: GenerateContentResponse) {
  return {
    candidates: chunk.candidates,
    promptFeedback: chunk.promptFeedback,
    usageMetadata: chunk.usageMetadata,
    modelVersion: chunk.modelVersion,
  };
}

async function record(recording: Recording): Promise<ModelEvent[]> {
  const chunks: unknown[] = [];
  const generate: GenerateStream = async (params) => {
    const stream = await ai.models.generateContentStream(params);
    return (async function* () {
      for await (const chunk of stream) {
        chunks.push(keep(chunk));
        yield chunk;
      }
    })();
  };
  const client = new GeminiModelClient({
    apiKey: "unused",
    model,
    generate,
    ...(recording.maxOutputTokens !== undefined && { maxOutputTokens: recording.maxOutputTokens }),
  });
  const events: ModelEvent[] = [];
  for await (const event of client.stream({
    system: SYSTEM,
    messages: recording.messages,
    tools: recording.tools,
    signal: AbortSignal.timeout(30_000),
  })) {
    events.push(event);
  }
  const fixture = {
    source: `Recorded ${new Date().toISOString().slice(0, 10)} from ${model} by scripts/record-gemini.ts.`,
    chunks,
  };
  await writeFile(
    new URL(`${recording.name}.json`, fixturesDir),
    `${JSON.stringify(fixture, null, 2)}\n`,
  );
  return events;
}

let failed = false;
let toolTurn: { messages: Message[]; events: ModelEvent[] } | undefined;
for (const recording of RECORDINGS) {
  const events = await record(recording);
  console.log(`\n${recording.name}:`, JSON.stringify(events, null, 2));
  if (
    events.at(-1)?.type !== "finish" ||
    (events.at(-1) as { reason: string }).reason === "error"
  ) {
    failed = true;
  }
  if (recording.name === "tool_call") toolTurn = { messages: recording.messages, events };
}

// The thought-signature check (ADR-0007): send the tool call back with a result. Without
// the signature Gemini answers 400, which the adapter reports as finish: error.
if (toolTurn) {
  const calls = toolTurn.events.flatMap((event) =>
    event.type === "tool_call" ? [event.call] : [],
  );
  const followUp: Message[] = [
    ...toolTurn.messages,
    { role: "assistant", text: "", toolCalls: calls },
    {
      role: "tool",
      results: calls.map((call) => ({
        callId: call.id,
        name: call.name,
        isError: false,
        content: JSON.stringify([{ key: "checkout-one-page", enabled: true }]),
      })),
    },
  ];
  const events = await record({ name: "after_tool_result", messages: followUp, tools: TOOLS });
  console.log("\nafter_tool_result:", JSON.stringify(events, null, 2));
  if (events.at(-1)?.type !== "finish" || (events.at(-1) as { reason: string }).reason !== "end") {
    failed = true;
  }
}

console.log(failed ? "\nLive check FAILED: see above." : "\nLive check passed.");
process.exit(failed ? 1 : 0);
