// Who is asking (mock auth, FP-12) and which sandbox they work in (ADR-0006).
// Plain functions over cookie values, so route handlers and tests don't need Next.js.
import { DEMO_USERS, type FlagStore } from "@flagpilot/db";
import type { User } from "@flagpilot/domain";
import type { Message } from "@flagpilot/model";
import { memoryStore, sandboxStore } from "./storage.ts";

export const USER_COOKIE = "fp_user";
export const SANDBOX_COOKIE = "fp_sandbox";
// A lowercase UUID, as crypto.randomUUID() makes. Postgres stores it in a uuid column,
// so anything else must be rejected before it reaches a query.
const SANDBOX_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ONE_DAY = 60 * 60 * 24;

/** Default user when no one is picked: the editor, so the demo can make changes. */
const DEFAULT_USER = DEMO_USERS[1] as User;

export function userFromId(id: string | undefined): User {
  return DEMO_USERS.find((user) => user.id === id) ?? DEFAULT_USER;
}

/** One visitor's own copy of the data, plus their conversations with the assistant. */
export class Sandbox {
  readonly store: FlagStore;
  // Conversations stay in server memory for now, even with Postgres: a long chat can lose
  // its earlier turns if the next request lands on another server instance.
  private readonly conversations = new Map<string, Message[]>();

  constructor(store: FlagStore) {
    this.store = store;
  }

  /** The conversation history of one user in this sandbox. */
  conversation(userId: string): Message[] {
    let messages = this.conversations.get(userId);
    if (messages === undefined) {
      messages = [];
      this.conversations.set(userId, messages);
    }
    return messages;
  }
}

// Kept on globalThis so sandboxes survive hot reloads in development. With DATABASE_URL
// set, each entry is a thin handle on the sandbox's rows in Postgres; FP-34 adds the
// daily cleanup.
const registry: Map<string, Sandbox> = ((
  globalThis as { flagpilotSandboxes?: Map<string, Sandbox> }
).flagpilotSandboxes ??= new Map());

export function getSandbox(id: string): Sandbox {
  let sandbox = registry.get(id);
  if (sandbox === undefined) {
    sandbox = new Sandbox(sandboxStore(id));
    registry.set(id, sandbox);
  }
  return sandbox;
}

/** For tests: forget every sandbox. */
export function resetSandboxes(): void {
  registry.clear();
}

export type Session = {
  user: User;
  sandboxId: string;
  sandbox: Sandbox;
  /** True when the visitor had no valid sandbox cookie: the response must set one. */
  isNewSandbox: boolean;
};

export function isSandboxId(id: string | undefined): id is string {
  return id !== undefined && SANDBOX_ID.test(id);
}

/**
 * The session for cookie values. A missing or malformed sandbox id gets a new sandbox:
 * - register: true (route handlers): it's kept, and the response sets its cookie;
 * - register: false (pages, which can't set cookies): a throwaway seeded copy, so page
 *   views without a cookie don't fill the server with unused sandboxes.
 */
export function resolveSession(
  cookies: { userId?: string | undefined; sandboxId?: string | undefined },
  options: { register: boolean } = { register: true },
): Session {
  const user = userFromId(cookies.userId);
  if (isSandboxId(cookies.sandboxId)) {
    const sandboxId = cookies.sandboxId;
    return { user, sandboxId, sandbox: getSandbox(sandboxId), isNewSandbox: false };
  }
  const sandboxId = crypto.randomUUID();
  // The throwaway copy stays in memory: nothing is written to it, so no rows are needed
  const sandbox = options.register ? getSandbox(sandboxId) : new Sandbox(memoryStore());
  return { user, sandboxId, sandbox, isNewSandbox: true };
}

/** One cookie's value from a Cookie header. */
export function readCookie(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function sessionFromRequest(request: Request): Session {
  const header = request.headers.get("cookie");
  return resolveSession({
    userId: readCookie(header, USER_COOKIE),
    sandboxId: readCookie(header, SANDBOX_COOKIE),
  });
}

/** Cookie settings shared by the route handlers and the server action. */
export const COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  sameSite: "lax",
  maxAge: ONE_DAY,
} as const;

/** A Set-Cookie header value for the sandbox id. */
export function sandboxCookieHeader(sandboxId: string): string {
  return `${SANDBOX_COOKIE}=${sandboxId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ONE_DAY}`;
}

/** Response headers for a session: sets the sandbox cookie when it's new. */
export function sessionHeaders(session: Session): Record<string, string> {
  return session.isNewSandbox ? { "set-cookie": sandboxCookieHeader(session.sandboxId) } : {};
}
