"use client";
// Mock auth (FP-12): pick who you are. The server reads the choice from a cookie.
import type { User } from "@flagpilot/domain";
import { switchUser } from "../app/actions.ts";

export function UserSwitcher({ users, current }: { users: readonly User[]; current: User }) {
  return (
    <form action={switchUser} className="user-switcher">
      <label htmlFor="user-select">Signed in as</label>
      {/* key: React resets a form after its action; remounting shows the new user */}
      <select
        key={current.id}
        id="user-select"
        name="userId"
        defaultValue={current.id}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name} ({user.role})
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit">Switch</button>
      </noscript>
    </form>
  );
}
