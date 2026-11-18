import { describe, expect, it } from "vitest";
import { applyChange, diff, settingsOf, type EnvSettings } from "../src/index.ts";

// A fresh copy each time, so one test can't change another's data
const makeBase = (): EnvSettings => ({
  enabled: true,
  targeting: { regions: ["EU", "NA"] },
  rolloutPercent: 25,
});
const base = makeBase();

describe("settingsOf", () => {
  it("drops the revision", () => {
    expect(settingsOf({ ...base, revision: 7 })).toEqual(base);
  });
});

describe("applyChange", () => {
  it("replaces only the fields in the change", () => {
    expect(applyChange(base, { rolloutPercent: 50 })).toEqual({ ...base, rolloutPercent: 50 });
  });

  it("replaces the whole region list", () => {
    expect(applyChange(base, { regions: ["APAC"] }).targeting.regions).toEqual(["APAC"]);
  });

  it("doesn't change its input", () => {
    const input = makeBase();
    applyChange(input, { enabled: false, regions: ["EU"] });
    expect(input).toEqual(base);
  });
});

describe("diff", () => {
  it("is empty when nothing differs", () => {
    expect(diff(base, makeBase())).toEqual([]);
  });

  it("treats regions as a set: order doesn't matter", () => {
    expect(diff(base, { ...base, targeting: { regions: ["NA", "EU"] } })).toEqual([]);
  });

  it("lists each changed field with before and after, in a fixed order", () => {
    const after: EnvSettings = {
      enabled: false,
      targeting: { regions: ["EU"] },
      rolloutPercent: 0,
    };
    expect(diff(base, after)).toEqual([
      { field: "enabled", before: true, after: false },
      { field: "regions", before: ["EU", "NA"], after: ["EU"] },
      { field: "rolloutPercent", before: 25, after: 0 },
    ]);
  });

  it("sees a region swap of the same length", () => {
    expect(diff(base, { ...base, targeting: { regions: ["EU", "APAC"] } })).toHaveLength(1);
  });
});
