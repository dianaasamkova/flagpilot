// Keeps docs/CONVENTIONS.md and the lists in packages/domain in sync:
// adding an area, team or tag in only one of them fails this test.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AREAS, TAGS, TEAMS } from "../packages/domain/src/conventions.ts";

const doc = readFileSync(join(import.meta.dirname, "..", "docs", "CONVENTIONS.md"), "utf8");

/** The `code` values in the first column of the tables in section "## <number>. …". */
function firstColumnValues(sectionNumber: number): string[] {
  const section = doc.split(/^## /m).find((part) => part.startsWith(`${sectionNumber}. `));
  if (section === undefined) throw new Error(`CONVENTIONS.md has no section ${sectionNumber}`);
  return [...section.matchAll(/^\| `([^`]+)` \|/gm)].flatMap((match) => match[1] ?? []);
}

describe("CONVENTIONS.md matches packages/domain", () => {
  it("lists the same areas (section 1)", () => {
    expect(firstColumnValues(1)).toEqual([...AREAS]);
  });

  it("lists the same teams (section 3)", () => {
    expect(firstColumnValues(3)).toEqual([...TEAMS]);
  });

  it("lists the same tags (section 4)", () => {
    expect(firstColumnValues(4)).toEqual([...TAGS]);
  });
});
