// Who may change what (FP-13). The server checks this twice: when a change is
// proposed (fast feedback) and again when it's confirmed (the real gate, ADR-0002).
import { z } from "zod";
import type { Environment } from "./flag.ts";

export const ROLES = ["viewer", "editor", "admin"] as const;
export const Role = z.enum(ROLES, {
  error: 'role must be "viewer", "editor" or "admin". Example: "editor".',
});
export type Role = z.infer<typeof Role>;

/** A signed-in person (mock auth in M2: a cookie picks one of the demo users). */
export const User = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  role: Role,
});
export type User = z.infer<typeof User>;

/** The environments each role may change. One table, easy to read and to test. */
export const WRITE_ACCESS: Readonly<Record<Role, readonly Environment[]>> = {
  viewer: [],
  editor: ["dev", "staging"],
  admin: ["dev", "staging", "production"],
};

/** True when the user may change flags in this environment. */
export function canWrite(user: Pick<User, "role">, env: Environment): boolean {
  return WRITE_ACCESS[user.role].includes(env);
}
