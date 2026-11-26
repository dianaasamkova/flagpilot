import { DemoModelClient } from "@flagpilot/model";
import { DEFAULT_GEMINI_MODEL, GeminiModelClient } from "@flagpilot/model/gemini";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModelClient } from "../../lib/server/model.ts";

describe("createModelClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the demo model by default", () => {
    expect(createModelClient({})).toBeInstanceOf(DemoModelClient);
    expect(createModelClient({ MODEL_PROVIDER: "" })).toBeInstanceOf(DemoModelClient);
  });

  it("uses Gemini with a key, on the default model unless GEMINI_MODEL is set", () => {
    const client = createModelClient({ MODEL_PROVIDER: "gemini", GEMINI_API_KEY: "test-key" });
    expect(client).toBeInstanceOf(GeminiModelClient);
    expect((client as GeminiModelClient).model).toBe(DEFAULT_GEMINI_MODEL);

    const lite = createModelClient({
      MODEL_PROVIDER: "gemini",
      GEMINI_API_KEY: "test-key",
      GEMINI_MODEL: "gemini-3.5-flash-lite",
    });
    expect((lite as GeminiModelClient).model).toBe("gemini-3.5-flash-lite");
  });

  it("falls back to the demo model when gemini has no key, and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(createModelClient({ MODEL_PROVIDER: "gemini" })).toBeInstanceOf(DemoModelClient);
    expect(createModelClient({ MODEL_PROVIDER: "gemini", GEMINI_API_KEY: "" })).toBeInstanceOf(
      DemoModelClient,
    );
    // Once per process, not once per request
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("GEMINI_API_KEY is empty");
  });

  it("falls back to the demo model for an unknown provider", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(createModelClient({ MODEL_PROVIDER: "gpt" })).toBeInstanceOf(DemoModelClient);
  });
});
