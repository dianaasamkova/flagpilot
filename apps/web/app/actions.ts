"use server";
// Server Functions called from forms. They may set cookies; pages may not.
import { cookies } from "next/headers";
import {
  COOKIE_OPTIONS,
  SANDBOX_COOKIE,
  USER_COOKIE,
  isSandboxId,
  resolveSession,
  userFromId,
} from "../lib/server/session.ts";

/** The header's user switcher (mock auth, FP-12). Unknown ids fall back to the editor. */
export async function switchUser(formData: FormData): Promise<void> {
  const jar = await cookies();
  const user = userFromId(String(formData.get("userId") ?? ""));
  jar.set(USER_COOKIE, user.id, COOKIE_OPTIONS);

  // Start the visitor's sandbox here too, so the page shows it from now on
  if (!isSandboxId(jar.get(SANDBOX_COOKIE)?.value)) {
    jar.set(SANDBOX_COOKIE, resolveSession({}).sandboxId, COOKIE_OPTIONS);
  }
}
