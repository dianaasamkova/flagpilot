import { ENVIRONMENTS, Environment, WRITE_ACCESS } from "@flagpilot/domain";
import { DEMO_PROMPTS } from "@flagpilot/model";
import Link from "next/link";
import { AssistantPanel } from "../components/AssistantPanel.tsx";
import { FlagTable } from "../components/FlagTable.tsx";
import { pageSession } from "../lib/server/page-session.ts";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ env?: string | string[] }>;
}) {
  const env = Environment.catch("staging").parse((await searchParams).env);
  const { user, sandbox } = await pageSession();
  const flags = await sandbox.store.listFlags();
  const writable = WRITE_ACCESS[user.role];

  return (
    <main className="layout">
      <section className="flags-section">
        <nav className="tabs" aria-label="Environment">
          {ENVIRONMENTS.map((name) => (
            <Link
              key={name}
              href={`/?env=${name}`}
              className={name === env ? "tab tab-active" : "tab"}
              aria-current={name === env ? "page" : undefined}
            >
              {name}
            </Link>
          ))}
        </nav>
        <p className="muted small">
          {writable.length === 0
            ? `${user.name} can read flags but not change them.`
            : `${user.name} can change: ${writable.join(", ")}.`}{" "}
          Every change goes through the assistant and your Confirm click.
        </p>
        <FlagTable flags={flags} env={env} />
      </section>
      {/* key: switching user starts a fresh conversation */}
      <AssistantPanel key={user.id} prompts={DEMO_PROMPTS} />
    </main>
  );
}
