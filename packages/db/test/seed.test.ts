import { Flag, FlagEvent, User } from "@flagpilot/domain";
import { describe, expect, it } from "vitest";
import { DEMO_USERS, seedEvents, seedFlags } from "../src/index.ts";

describe("seed data", () => {
  it.each(seedFlags().map((flag) => [flag.key, flag] as const))(
    "%s follows the Flag schema and the conventions",
    (_key, flag) => {
      expect(Flag.safeParse(flag).error?.issues ?? []).toEqual([]);
    },
  );

  it("has about 12 flags with unique keys", () => {
    const keys = seedFlags().map((flag) => flag.key);
    expect(keys).toHaveLength(12);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has valid history events that match the flags' current state", () => {
    const flags = new Map(seedFlags().map((flag) => [flag.key, flag]));
    for (const event of seedEvents()) {
      expect(FlagEvent.safeParse(event).success).toBe(true);
      expect(flags.has(event.flagKey)).toBe(true);
    }
    // The latest event per flag and environment shows the current settings and revision
    const latest = new Map<string, FlagEvent>();
    for (const event of seedEvents()) {
      const id = `${event.flagKey}/${event.env}`;
      const seen = latest.get(id);
      if (seen === undefined || seen.at < event.at) latest.set(id, event);
    }
    for (const event of latest.values()) {
      const { revision, ...settings } = flags.get(event.flagKey)?.envs[event.env] ?? {};
      expect(settings).toEqual(event.after);
      expect(revision).toBe(event.revision);
    }
  });

  it("has one demo user per role", () => {
    expect(DEMO_USERS.map((user) => User.parse(user).role)).toEqual(["viewer", "editor", "admin"]);
  });

  it("returns a fresh copy each time", () => {
    const [first] = seedFlags();
    if (first) first.description = "changed";
    expect(seedFlags()[0]?.description).not.toBe("changed");
  });
});
