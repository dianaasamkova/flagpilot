// ModelClient interface and adapters: fake (tests), demo (local, no key).
// The Gemini adapter is imported from "@flagpilot/model/gemini", so only server code loads its SDK.
export * from "./demo.ts";
export * from "./fake.ts";
export * from "./types.ts";
