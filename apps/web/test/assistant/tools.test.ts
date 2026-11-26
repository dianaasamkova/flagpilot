import { DEMO_USERS, MemoryFlagStore, seedEvents, seedFlags } from "@flagpilot/db";
import type { User } from "@flagpilot/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  TOOL_DEFINITIONS,
  createToolHandlers,
  type ToolHandlers,
  type ToolOutcome,
} from "../../lib/assistant/tools.ts";

const [, editor] = DEMO_USERS as [User, User, User];

let tools: ToolHandlers;
beforeEach(() => {
  tools = createToolHandlers(
    new MemoryFlagStore({ flags: seedFlags(), events: seedEvents() }),
    editor,
  );
});

/** The flag keys in a list_flags result. */
function keys(outcome: ToolOutcome): string[] {
  if (!outcome.ok) throw new Error(outcome.message);
  return (outcome.data as { key: string }[]).map((flag) => flag.key);
}

describe("list_flags", () => {
  it("lists every flag without filters", async () => {
    expect(keys(await tools.list_flags({}))).toHaveLength(12);
  });

  it("filters by on/off in one environment and shows only that environment", async () => {
    const outcome = await tools.list_flags({ env: "production", enabled: false });
    // Sorted by key, like every store returns them
    expect(keys(outcome)).toEqual([
      "account-passwordless-login",
      "catalog-legacy-reviews",
      "checkout-one-page",
      "platform-maintenance-mode",
      "search-semantic-ranking",
    ]);
    const [first] = outcome.ok ? (outcome.data as { envs: object }[]) : [];
    expect(Object.keys(first?.envs ?? {})).toEqual(["production"]);
  });

  it("filters by tag", async () => {
    expect(keys(await tools.list_flags({ tag: "permanent" }))).toEqual([
      "platform-image-cdn",
      "platform-maintenance-mode",
    ]);
  });

  it("searches key and description, ignoring case", async () => {
    expect(keys(await tools.list_flags({ query: "GIFT" }))).toEqual(["checkout-gift-wrap"]);
    expect(keys(await tools.list_flags({ query: "typo" }))).toEqual(["search-typo-tolerance"]);
  });
});

describe("get_flag and explain_flag_history", () => {
  it("returns a flag or tells the model to use list_flags", async () => {
    expect((await tools.get_flag({ key: "search-v2" })).ok).toBe(false);
    expect(await tools.get_flag({ key: "search-v2" })).toMatchObject({
      message: expect.stringContaining("list_flags"),
    });
    expect((await tools.get_flag({ key: "checkout-gift-wrap" })).ok).toBe(true);
  });

  it("returns history newest first, limited", async () => {
    const outcome = await tools.explain_flag_history({ key: "checkout-one-page", limit: 1 });
    expect(outcome.ok && outcome.data).toMatchObject([{ id: "e-2" }]);
  });
});

describe("TOOL_DEFINITIONS", () => {
  it("describes the four tools with their JSON Schema", () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      "list_flags",
      "get_flag",
      "propose_flag_change",
      "explain_flag_history",
    ]);
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
    }
  });

  it("tells the model that proposing doesn't apply anything", () => {
    const propose = TOOL_DEFINITIONS.find((tool) => tool.name === "propose_flag_change");
    expect(propose?.description).toContain("does NOT apply");
  });
});
