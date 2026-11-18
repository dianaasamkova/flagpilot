// The session for server components. Pages can read cookies but not set them, so a
// visitor without a sandbox sees a throwaway seeded copy until their first action.
import { cookies } from "next/headers";
import { SANDBOX_COOKIE, USER_COOKIE, resolveSession, type Session } from "./session.ts";

export async function pageSession(): Promise<Session> {
  const jar = await cookies();
  return resolveSession(
    { userId: jar.get(USER_COOKIE)?.value, sandboxId: jar.get(SANDBOX_COOKIE)?.value },
    { register: false },
  );
}
