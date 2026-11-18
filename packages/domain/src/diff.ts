// What a change does to a flag's settings in one environment (FP-22). Pure functions:
// no database, no clock, so the ProposalCard, the confirm step and the tests agree.
import type { FlagChangeSet } from "./flag-change.ts";
import type { EnvConfig, EnvSettings, Region } from "./flag.ts";

/** One field that differs, as the ProposalCard shows it. */
export type FieldDiff =
  | { field: "enabled"; before: boolean; after: boolean }
  | { field: "regions"; before: Region[]; after: Region[] }
  | { field: "rolloutPercent"; before: number; after: number };

/** The settings part of an EnvConfig. */
export function settingsOf(config: EnvConfig): EnvSettings {
  return {
    enabled: config.enabled,
    targeting: { regions: [...config.targeting.regions] },
    rolloutPercent: config.rolloutPercent,
  };
}

/** The settings after a change. Fields the change leaves out keep their current value. */
export function applyChange(settings: EnvSettings, set: FlagChangeSet): EnvSettings {
  return {
    enabled: set.enabled ?? settings.enabled,
    targeting: { regions: [...(set.regions ?? settings.targeting.regions)] },
    rolloutPercent: set.rolloutPercent ?? settings.rolloutPercent,
  };
}

/** Regions are a set: ["EU", "NA"] and ["NA", "EU"] mean the same thing. */
function sameRegions(a: readonly Region[], b: readonly Region[]): boolean {
  return a.length === b.length && a.every((region) => b.includes(region));
}

/** The fields that differ, in a fixed order. An empty list means "no change". */
export function diff(before: EnvSettings, after: EnvSettings): FieldDiff[] {
  const changes: FieldDiff[] = [];
  if (before.enabled !== after.enabled) {
    changes.push({ field: "enabled", before: before.enabled, after: after.enabled });
  }
  if (!sameRegions(before.targeting.regions, after.targeting.regions)) {
    changes.push({
      field: "regions",
      before: [...before.targeting.regions],
      after: [...after.targeting.regions],
    });
  }
  if (before.rolloutPercent !== after.rolloutPercent) {
    changes.push({
      field: "rolloutPercent",
      before: before.rolloutPercent,
      after: after.rolloutPercent,
    });
  }
  return changes;
}
