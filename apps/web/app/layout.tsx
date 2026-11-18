import { DEMO_USERS } from "@flagpilot/db";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { UserSwitcher } from "../components/UserSwitcher.tsx";
import { pageSession } from "../lib/server/page-session.ts";
import "./globals.css";

export const metadata: Metadata = {
  title: "FlagPilot",
  description: "Safe feature-flag operations for humans and AI agents.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { user } = await pageSession();
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="brand">
            <span className="logo" aria-hidden="true">
              ⚑
            </span>
            <span>
              <strong>FlagPilot</strong>
              <span className="muted"> · Bramble Market</span>
            </span>
          </div>
          <UserSwitcher users={DEMO_USERS} current={user} />
        </header>
        {children}
      </body>
    </html>
  );
}
