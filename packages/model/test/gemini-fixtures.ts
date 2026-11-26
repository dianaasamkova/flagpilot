// Recorded (or hand-written) Gemini responses, played back in place of the network.
import { readFileSync, readdirSync } from "node:fs";
import { ApiError, type GenerateContentResponse } from "@google/genai";
import type { GenerateStream } from "../src/gemini.ts";

export const FIXTURES_DIR = new URL("./fixtures/gemini/", import.meta.url);

export type GeminiFixture = {
  source: string;
  chunks?: unknown[];
  error?: { status: number; message: string };
};

export function loadFixture(name: string): GeminiFixture {
  return JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES_DIR), "utf8")) as GeminiFixture;
}

export function fixtureNames(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length));
}

/** A GenerateStream that plays the given chunks, or throws the fixture's API error. */
export function playChunks(fixture: GeminiFixture): GenerateStream {
  return async () => {
    if (fixture.error) throw new ApiError(fixture.error);
    const chunks = (fixture.chunks ?? []) as GenerateContentResponse[];
    return (async function* () {
      yield* chunks;
    })();
  };
}

/** A GenerateStream that sends one text chunk, then waits for the abort like the real SDK. */
export const hangAfterFirstChunk: GenerateStream = async (params) => {
  const signal = params.config?.abortSignal;
  return (async function* () {
    yield {
      candidates: [{ content: { role: "model", parts: [{ text: "Let me" }] } }],
    } as GenerateContentResponse;
    await new Promise((_resolve, reject) => {
      // The SDK fails with its own error, not the abort reason; the adapter must rethrow the reason
      const fail = () => reject(new DOMException("This operation was aborted", "AbortError"));
      if (signal?.aborted) fail();
      signal?.addEventListener("abort", fail, { once: true });
    });
  })();
};
