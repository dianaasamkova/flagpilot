import { describe, expect, it } from "vitest";
import { ENVIRONMENTS, ROLES, canWrite, type Environment, type Role } from "../src/index.ts";

// Every role × environment, written out so the table is the test
const EXPECTED: Record<Role, Record<Environment, boolean>> = {
  viewer: { dev: false, staging: false, production: false },
  editor: { dev: true, staging: true, production: false },
  admin: { dev: true, staging: true, production: true },
};

describe("canWrite", () => {
  const cases = ROLES.flatMap((role) =>
    ENVIRONMENTS.map((env) => [role, env, EXPECTED[role][env]] as const),
  );

  it.each(cases)("%s in %s → %s", (role, env, expected) => {
    expect(canWrite({ role }, env)).toBe(expected);
  });

  it("covers all 9 combinations", () => {
    expect(cases).toHaveLength(9);
  });
});
