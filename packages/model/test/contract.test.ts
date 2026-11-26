// The same contract suite runs on the fake model and on the Gemini adapter (FP-19).
import { GeminiModelClient } from "../src/gemini.ts";
import { FakeModelClient, toolCall, type FakeTurn } from "../src/index.ts";
import { describeModelClientContract, type Scenario } from "./contract.ts";
import { hangAfterFirstChunk, loadFixture, playChunks } from "./gemini-fixtures.ts";

const FAKE_SCRIPTS: Record<Scenario, FakeTurn> = {
  plain: [
    { type: "text_delta", text: "A feature flag " },
    { type: "text_delta", text: "turns a feature on or off." },
    { type: "finish", reason: "end" },
  ],
  tool_call: [
    toolCall("c1", "list_flags", { env: "staging", enabled: true }, "signature-1"),
    { type: "finish", reason: "tool_calls" },
  ],
  parallel_calls: [
    toolCall("c1", "get_flag", { key: "checkout-one-page" }, "signature-2"),
    toolCall("c2", "get_flag", { key: "search-semantic-ranking" }),
    { type: "finish", reason: "tool_calls" },
  ],
  max_tokens: [
    { type: "text_delta", text: "Feature flags let a team" },
    { type: "finish", reason: "max_tokens" },
  ],
  refused: [{ type: "finish", reason: "refused" }],
  quota: [{ type: "finish", reason: "error", errorKind: "quota" }],
};

describeModelClientContract("FakeModelClient", {
  clientFor: (scenario) => new FakeModelClient([FAKE_SCRIPTS[scenario]]),
  hangingClient: () => new FakeModelClient(["hang"]),
});

describeModelClientContract("GeminiModelClient", {
  clientFor: (scenario) =>
    new GeminiModelClient({ apiKey: "unused", generate: playChunks(loadFixture(scenario)) }),
  hangingClient: () => new GeminiModelClient({ apiKey: "unused", generate: hangAfterFirstChunk }),
});
