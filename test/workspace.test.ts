// Guards the workspace layout so a new package can't silently break the shared setup.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const readJson = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));

const packageDirs = ["apps", "packages"].flatMap((group) =>
  readdirSync(join(root, group)).map((name) => `${group}/${name}`),
);

describe("workspace", () => {
  it("pins the Node major version in .nvmrc and engines", () => {
    const nvmrc = readFileSync(join(root, ".nvmrc"), "utf8").trim();
    expect(readJson("package.json").engines.node).toBe(`>=${nvmrc} <${Number(nvmrc) + 1}`);
  });

  it.each(packageDirs)("%s is a private ESM package named @flagpilot/*", (dir) => {
    const pkg = readJson(`${dir}/package.json`);
    expect(pkg.name).toMatch(/^@flagpilot\//);
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe("module");
  });

  it.each(packageDirs)("%s has a typecheck script and extends the shared tsconfig", (dir) => {
    expect(readJson(`${dir}/package.json`).scripts.typecheck).toBe("tsc --noEmit");
    expect(readJson(`${dir}/tsconfig.json`).extends).toBe("../../tsconfig.base.json");
  });
});
