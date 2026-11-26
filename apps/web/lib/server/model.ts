// Picks the model adapter from configuration, on the server only (ADR-0005, ADR-0007).
import { DemoModelClient, type ModelClient } from "@flagpilot/model";
import { DEFAULT_GEMINI_MODEL, GeminiModelClient } from "@flagpilot/model/gemini";

// process.env, or a plain object in tests. Reads MODEL_PROVIDER, GEMINI_API_KEY, GEMINI_MODEL.
type ModelEnv = Readonly<Record<string, string | undefined>>;

// Each warning is printed once per server process, not on every request
const warned = new Set<string>();
function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

/**
 * MODEL_PROVIDER:
 * - "demo" (default): the rule-based offline model, no key needed;
 * - "gemini": Gemini's free tier. Needs GEMINI_API_KEY; without it, falls back to "demo".
 * GEMINI_MODEL picks the Gemini model; empty means DEFAULT_GEMINI_MODEL.
 */
export function createModelClient(env: ModelEnv = process.env): ModelClient {
  const provider = env.MODEL_PROVIDER || "demo";
  switch (provider) {
    case "demo":
      return new DemoModelClient();
    case "gemini": {
      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey) {
        warnOnce('MODEL_PROVIDER is "gemini" but GEMINI_API_KEY is empty, using "demo"');
        return new DemoModelClient();
      }
      return new GeminiModelClient({ apiKey, model: env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL });
    }
    default:
      warnOnce(`MODEL_PROVIDER "${provider}" isn't known, using "demo"`);
      return new DemoModelClient();
  }
}
