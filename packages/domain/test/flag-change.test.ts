import { describe, expect, expectTypeOf, it } from "vitest";
import { FlagChange, type Environment, type Region } from "../src/index.ts";

const valid = {
  flagKey: "checkout-one-page",
  env: "staging",
  set: { enabled: true, regions: ["EU"], rolloutPercent: 25 },
  reason: "Start the EU beta",
};

/** The issues for a change; empty when the change is valid. */
function issues(input: unknown) {
  const result = FlagChange.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
}

/** Parses `valid` with a different `set`. */
const withSet = (set: unknown) => issues({ ...valid, set });

describe("FlagChange", () => {
  it("accepts a valid change", () => {
    expect(issues(valid)).toEqual([]);
  });

  it.each([{ enabled: false }, { regions: ["NA", "APAC"] }, { rolloutPercent: 0 }])(
    "accepts a change of one field: %o",
    (set) => {
      expect(withSet(set)).toEqual([]);
    },
  );

  describe("rule 1: set changes at least one field", () => {
    it("passes with one field", () => {
      expect(withSet({ rolloutPercent: 50 })).toEqual([]);
    });

    it.each([{}, { enabled: undefined }])("fails with %o and lists the fields", (set) => {
      expect(withSet(set)).toEqual([
        {
          path: ["set"],
          message:
            'set must change at least one of "enabled", "regions" or "rolloutPercent". Example: { "enabled": true }.',
        },
      ]);
    });
  });

  describe("rule 2: enabled false with rolloutPercent above 0 is rejected", () => {
    it.each([
      { enabled: false, rolloutPercent: 0 },
      { enabled: true, rolloutPercent: 30 },
      // Without "enabled", the server checks the current state at propose time (FP-23)
      { rolloutPercent: 30 },
    ])("passes with %o", (set) => {
      expect(withSet(set)).toEqual([]);
    });

    it("fails with enabled false and rolloutPercent 30, pointing at rolloutPercent", () => {
      const [issue] = withSet({ enabled: false, rolloutPercent: 30 });
      expect(issue?.path).toEqual(["set", "rolloutPercent"]);
      expect(issue?.message).toContain("Either set enabled to true, or set rolloutPercent to 0");
    });
  });

  describe("rule 3: regions has at least one region and no duplicates", () => {
    it("passes with distinct regions", () => {
      expect(withSet({ regions: ["EU", "NA", "APAC"] })).toEqual([]);
    });

    it("fails with an empty list", () => {
      expect(withSet({ regions: [] })[0]?.message).toContain("turn the flag off instead");
    });

    it("fails with a repeated region", () => {
      expect(withSet({ regions: ["EU", "EU"] })[0]?.message).toContain("only once");
    });
  });

  describe("other fields", () => {
    it("rejects fields that a change can't touch, such as the key", () => {
      expect(withSet({ key: "checkout-renamed", enabled: true })).toEqual([
        {
          path: ["set"],
          message: 'set can only change "enabled", "regions" or "rolloutPercent". Remove: key.',
        },
      ]);
    });

    it("rejects a rolloutPercent outside 0–100", () => {
      expect(withSet({ rolloutPercent: 150 })[0]?.message).toContain("from 0 to 100");
    });

    it("checks flagKey and env with the shared schemas", () => {
      expect(issues({ ...valid, flagKey: "new-button", env: "prod" }).map((i) => i.path)).toEqual([
        ["flagKey"],
        ["env"],
      ]);
    });

    it.each([
      ["too short", "ok"],
      ["only spaces", "     "],
      ["too long", "a".repeat(201)],
    ])("rejects a reason that is %s", (_case, reason) => {
      expect(issues({ ...valid, reason })[0]?.message).toContain("3–200 characters");
    });

    it("trims the reason", () => {
      expect(FlagChange.parse({ ...valid, reason: "  Start the beta  " }).reason).toBe(
        "Start the beta",
      );
    });
  });

  it("has the expected type", () => {
    expectTypeOf<FlagChange>().toEqualTypeOf<{
      flagKey: string;
      env: Environment;
      set: {
        enabled?: boolean | undefined;
        regions?: Region[] | undefined;
        rolloutPercent?: number | undefined;
      };
      reason: string;
    }>();
  });
});
