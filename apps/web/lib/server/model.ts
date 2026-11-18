// Picks the model adapter from configuration, on the server only (ADR-0005).
import { DemoModelClient, type ModelClient } from "@flagpilot/model";

/**
 * MODEL_PROVIDER:
 * - "demo" (default): the rule-based offline model, no key needed;
 * - "gemini": arrives in M3 (FP-19). Until then it falls back to "demo".
 */
export function createModelClient(provider = process.env.MODEL_PROVIDER ?? "demo"): ModelClient {
  switch (provider) {
    case "demo":
      return new DemoModelClient();
    default:
      console.warn(`MODEL_PROVIDER "${provider}" isn't available yet, using "demo"`);
      return new DemoModelClient();
  }
}
