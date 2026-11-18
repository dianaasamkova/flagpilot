import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import {
  ExplainFlagHistoryInput,
  FlagChange,
  GetFlagInput,
  ListFlagsInput,
  ProposeFlagChangeInput,
  TOOL_INPUTS,
  toolInputJsonSchema,
  type ToolName,
} from "../src/index.ts";

/** The error messages a schema gives for an input; empty when the input is valid. */
function messages(schema: z.ZodType, input: unknown): string[] {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe("list_flags", () => {
  it.each([
    {},
    { env: "production" },
    { env: "staging", enabled: true },
    { tag: "experiment" },
    { query: "checkout" },
  ])("accepts %o", (input) => {
    expect(messages(ListFlagsInput, input)).toEqual([]);
  });

  it("rejects enabled without env and explains why", () => {
    const result = ListFlagsInput.safeParse({ enabled: true });
    expect(result.error?.issues[0]?.path).toEqual(["enabled"]);
    expect(result.error?.issues[0]?.message).toContain('Add "env"');
  });

  it.each([
    ["empty", "   "],
    ["longer than 50 characters", "a".repeat(51)],
  ])("rejects a query that is %s", (_case, query) => {
    expect(messages(ListFlagsInput, { query })[0]).toContain("1–50 characters");
  });

  it("rejects a tag that isn't on the list", () => {
    expect(messages(ListFlagsInput, { tag: "urgent" })[0]).toContain("Tag must be");
  });

  it("rejects unknown filters", () => {
    expect(messages(ListFlagsInput, { owner: "team-search" })[0]).toContain("owner");
  });
});

describe("get_flag", () => {
  it("accepts a valid key", () => {
    expect(messages(GetFlagInput, { key: "search-v2" })).toEqual([]);
  });

  it("checks the key with the shared FlagKey rules", () => {
    expect(messages(GetFlagInput, { key: "new-button" })[0]).toContain("must start with an area");
  });

  it("requires the key", () => {
    expect(GetFlagInput.safeParse({}).error?.issues[0]?.path).toEqual(["key"]);
  });
});

describe("propose_flag_change", () => {
  it("is exactly the FlagChange schema, so all its rules apply", () => {
    expect(ProposeFlagChangeInput).toBe(FlagChange);
  });
});

describe("explain_flag_history", () => {
  it("fills in limit 10 when it's left out", () => {
    expect(ExplainFlagHistoryInput.parse({ key: "search-v2" })).toEqual({
      key: "search-v2",
      limit: 10,
    });
  });

  it.each([1, 50])("accepts limit %d", (limit) => {
    expect(messages(ExplainFlagHistoryInput, { key: "search-v2", limit })).toEqual([]);
  });

  it.each([0, 51, 2.5])("rejects limit %s", (limit) => {
    expect(messages(ExplainFlagHistoryInput, { key: "search-v2", limit })).toEqual([
      "limit must be a whole number from 1 to 50. Example: 10.",
    ]);
  });

  it("rejects an unknown environment", () => {
    expect(messages(ExplainFlagHistoryInput, { key: "search-v2", env: "prod" })[0]).toContain(
      "Environment must be",
    );
  });

  it("makes limit optional for the caller and always present after parsing", () => {
    expectTypeOf<z.input<typeof ExplainFlagHistoryInput>["limit"]>().toEqualTypeOf<
      number | undefined
    >();
    expectTypeOf<ExplainFlagHistoryInput["limit"]>().toEqualTypeOf<number>();
  });
});

describe("TOOL_INPUTS", () => {
  it("has the four tools", () => {
    expect(Object.keys(TOOL_INPUTS)).toEqual([
      "list_flags",
      "get_flag",
      "propose_flag_change",
      "explain_flag_history",
    ]);
  });
});

// What the model sees. A schema change that alters it shows up as a diff in the PR.
describe("JSON Schema the model sees", () => {
  it.each(Object.keys(TOOL_INPUTS) as ToolName[])("%s matches its snapshot", async (name) => {
    const json = `${JSON.stringify(toolInputJsonSchema(name), null, 2)}\n`;
    await expect(json).toMatchFileSnapshot(`./__snapshots__/${name}.json`);
  });

  it("rejects unknown fields in every tool", () => {
    for (const name of Object.keys(TOOL_INPUTS) as ToolName[]) {
      expect(toolInputJsonSchema(name).additionalProperties).toBe(false);
    }
  });

  it("keeps limit optional for the model, because it has a default", () => {
    expect(toolInputJsonSchema("explain_flag_history").required).toEqual(["key"]);
  });
});
