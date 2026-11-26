import { beforeEach, describe, expect, it } from "vitest";
import {
  getSandbox,
  readCookie,
  resetSandboxes,
  resolveSession,
  userFromId,
} from "../../lib/server/session.ts";

beforeEach(() => resetSandboxes());

const ID = "11111111-2222-3333-4444-555555555555";

describe("readCookie", () => {
  it("finds a cookie among others", () => {
    expect(readCookie("a=1; fp_user=u-admin; b=2", "fp_user")).toBe("u-admin");
  });

  it("returns undefined when it's missing or there's no header", () => {
    expect(readCookie("a=1", "fp_user")).toBeUndefined();
    expect(readCookie(null, "fp_user")).toBeUndefined();
  });
});

describe("userFromId", () => {
  it("finds a demo user and falls back to the editor", () => {
    expect(userFromId("u-admin").role).toBe("admin");
    expect(userFromId("someone-else").role).toBe("editor");
    expect(userFromId(undefined).role).toBe("editor");
  });
});

describe("resolveSession", () => {
  it("reuses the sandbox of a valid cookie", () => {
    const session = resolveSession({ sandboxId: ID });
    expect(session.isNewSandbox).toBe(false);
    expect(session.sandbox).toBe(getSandbox(ID));
  });

  it.each([undefined, "not-a-uuid", "../../etc", "-".repeat(36)])(
    "starts a new sandbox for %s",
    (sandboxId) => {
      const session = resolveSession({ sandboxId });
      expect(session.isNewSandbox).toBe(true);
      expect(session.sandboxId).toMatch(/^[0-9a-f-]{36}$/);
      expect(session.sandbox).toBe(getSandbox(session.sandboxId));
    },
  );

  it("doesn't keep a throwaway sandbox for a page view", () => {
    const session = resolveSession({}, { register: false });
    expect(getSandbox(session.sandboxId)).not.toBe(session.sandbox);
  });
});
