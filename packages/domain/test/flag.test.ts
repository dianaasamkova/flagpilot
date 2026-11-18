import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import {
  EnvConfig,
  Environment,
  Flag,
  FlagKey,
  Region,
  Targeting,
  type EnvConfig as EnvConfigType,
  type Flag as FlagType,
} from "../src/index.ts";

/** The error messages a schema gives for an input; empty when the input is valid. */
function messages(schema: z.ZodType, input: unknown): string[] {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

const validEnv: EnvConfigType = {
  enabled: true,
  targeting: { regions: ["EU", "NA"] },
  rolloutPercent: 25,
  revision: 3,
};

const validFlag: FlagType = {
  key: "checkout-one-page",
  description: "Shows the one-page checkout instead of the three-step one.",
  owner: "team-checkout",
  tags: ["release", "beta"],
  envs: { dev: validEnv, staging: validEnv, production: { ...validEnv, enabled: false } },
};

describe("Environment", () => {
  it.each(["dev", "staging", "production"])("accepts %s", (env) => {
    expect(messages(Environment, env)).toEqual([]);
  });

  it("rejects an unknown environment and lists the valid ones", () => {
    expect(messages(Environment, "prod")).toEqual([
      'Environment must be "dev", "staging" or "production". Example: "staging".',
    ]);
  });

  it("has the type dev | staging | production", () => {
    expectTypeOf<Environment>().toEqualTypeOf<"dev" | "staging" | "production">();
  });
});

describe("Region", () => {
  it.each(["EU", "NA", "APAC"])("accepts %s", (region) => {
    expect(messages(Region, region)).toEqual([]);
  });

  it("rejects lowercase and hints at capital letters", () => {
    expect(messages(Region, "eu")[0]).toContain("capital letters");
  });
});

describe("FlagKey", () => {
  it.each(["checkout-new-button", "search-v2", "payments-3ds-check", "platform-cdn"])(
    "accepts %s",
    (key) => {
      expect(messages(FlagKey, key)).toEqual([]);
    },
  );

  it.each([
    ["too short", "ab", "too short"],
    ["too long", `checkout-${"a".repeat(56)}`, "too long"],
    ["uppercase", "Checkout-new-button", "kebab-case"],
    ["underscore", "checkout_new_button", "kebab-case"],
    ["double hyphen", "checkout--button", "kebab-case"],
    ["trailing hyphen", "checkout-button-", "kebab-case"],
    ["starts with a digit", "1checkout-button", "kebab-case"],
    ["unknown area", "cart-new-button", "must start with an area"],
    ["area alone", "checkout", "must start with an area"],
    ["not a string", 42, "must be a string"],
  ])("rejects %s", (_rule, key, hint) => {
    expect(messages(FlagKey, key).join(" ")).toContain(hint);
  });

  it("gives one clear message for a bad format, without the area message", () => {
    expect(messages(FlagKey, "Checkout_New")).toEqual([
      'Flag key must be kebab-case: lowercase letters and digits, words joined by single hyphens, starting with a letter. Example: "checkout-new-button".',
    ]);
  });

  it("names every area and gives an example when the area is wrong", () => {
    expect(messages(FlagKey, "cart-new-button")).toEqual([
      'Flag key must start with an area ("checkout", "search", "catalog", "account", "payments" or "platform") followed by at least one more word. Example: "checkout-new-button".',
    ]);
  });

  it("allows exactly 64 characters", () => {
    expect(messages(FlagKey, `checkout-${"a".repeat(55)}`)).toEqual([]);
  });
});

describe("Targeting", () => {
  it("accepts one or more regions", () => {
    expect(messages(Targeting, { regions: ["APAC"] })).toEqual([]);
  });

  it("rejects an empty list and suggests turning the flag off", () => {
    expect(messages(Targeting, { regions: [] })[0]).toContain("turn the flag off instead");
  });

  it("rejects a repeated region", () => {
    expect(messages(Targeting, { regions: ["EU", "EU"] })[0]).toContain("only once");
  });

  it("rejects unknown fields, such as a typo", () => {
    expect(messages(Targeting, { regions: ["EU"], region: "NA" })[0]).toContain("region");
  });
});

describe("EnvConfig", () => {
  it("accepts a valid config", () => {
    expect(messages(EnvConfig, validEnv)).toEqual([]);
  });

  it.each([0, 100])("accepts rolloutPercent %d", (rolloutPercent) => {
    expect(messages(EnvConfig, { ...validEnv, rolloutPercent })).toEqual([]);
  });

  it.each([-1, 101, 12.5, "50"])("rejects rolloutPercent %s", (rolloutPercent) => {
    expect(messages(EnvConfig, { ...validEnv, rolloutPercent })).toEqual([
      "rolloutPercent must be a whole number from 0 to 100. Example: 25.",
    ]);
  });

  it.each([-1, 1.5])("rejects revision %s", (revision) => {
    expect(messages(EnvConfig, { ...validEnv, revision })[0]).toContain("0 or more");
  });

  it("rejects enabled that isn't a boolean", () => {
    expect(messages(EnvConfig, { ...validEnv, enabled: "yes" })[0]).toContain("true or false");
  });

  it("has the expected type", () => {
    expectTypeOf<EnvConfigType>().toEqualTypeOf<{
      enabled: boolean;
      targeting: { regions: ("EU" | "NA" | "APAC")[] };
      rolloutPercent: number;
      revision: number;
    }>();
  });
});

describe("Flag", () => {
  it("accepts a valid flag", () => {
    expect(messages(Flag, validFlag)).toEqual([]);
  });

  it("accepts a flag with no tags", () => {
    expect(messages(Flag, { ...validFlag, tags: [] })).toEqual([]);
  });

  it("trims the description", () => {
    expect(Flag.parse({ ...validFlag, description: "  Shows it.  " }).description).toBe(
      "Shows it.",
    );
  });

  it.each([
    ["empty", ""],
    ["only spaces", "   "],
    ["longer than 280 characters", "a".repeat(281)],
  ])("rejects a description that is %s", (_case, description) => {
    expect(messages(Flag, { ...validFlag, description })[0]).toContain("1–280 characters");
  });

  it("rejects a person as owner", () => {
    expect(messages(Flag, { ...validFlag, owner: "alice" })[0]).toContain(
      "must be a team, not a person",
    );
  });

  it("rejects a tag that isn't on the list", () => {
    expect(messages(Flag, { ...validFlag, tags: ["urgent"] })[0]).toContain(
      'Tag must be "release", "experiment", "ops", "permanent" or "beta"',
    );
  });

  it("rejects a repeated tag", () => {
    expect(messages(Flag, { ...validFlag, tags: ["beta", "beta"] })[0]).toContain("only once");
  });

  it("requires a config for every environment and says which one is missing", () => {
    const result = Flag.safeParse({ ...validFlag, envs: { dev: validEnv, production: validEnv } });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["envs", "staging"]]);
  });

  it("rejects an unknown environment in envs", () => {
    const envs = { ...validFlag.envs, prod: validEnv };
    expect(messages(Flag, { ...validFlag, envs })[0]).toContain("prod");
  });

  it("has exactly one envs entry per Environment", () => {
    expectTypeOf<keyof FlagType["envs"]>().toEqualTypeOf<Environment>();
  });
});
