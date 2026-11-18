"use client";
// The change card (FP-24). It renders the stored proposal, never the model's text:
// if the two disagree, the card is the truth (ADR-0002).
import { diff, type FieldDiff, type Proposal } from "@flagpilot/domain";
import { useState } from "react";

type State =
  | { kind: "pending" }
  | { kind: "busy" }
  | { kind: "confirmed" }
  | { kind: "discarded" }
  | { kind: "failed"; message: string };

const FIELD_LABELS: Record<FieldDiff["field"], string> = {
  enabled: "Enabled",
  regions: "Regions",
  rolloutPercent: "Rollout",
};

function formatValue(change: FieldDiff, side: "before" | "after"): string {
  switch (change.field) {
    case "enabled":
      return change[side] ? "On" : "Off";
    case "regions":
      return change[side].join(", ");
    case "rolloutPercent":
      return `${change[side]}%`;
  }
}

export function ProposalCard({
  proposal,
  onApplied,
}: {
  proposal: Proposal;
  onApplied: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "pending" });
  const changes = diff(proposal.before, proposal.after);
  const expires = new Date(proposal.expiresAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  async function act(action: "confirm" | "discard") {
    setState({ kind: "busy" });
    try {
      const response = await fetch(`/api/proposals/${proposal.id}/${action}`, { method: "POST" });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        setState({ kind: "failed", message: body.message ?? "Something went wrong." });
        return;
      }
      setState({ kind: action === "confirm" ? "confirmed" : "discarded" });
      if (action === "confirm") onApplied();
    } catch {
      setState({ kind: "failed", message: "Network error. Please try again." });
    }
  }

  return (
    <section className="card" aria-label={`Proposed change to ${proposal.flagKey}`}>
      <header className="card-head">
        <span className="card-title">
          <code>{proposal.flagKey}</code> in <strong>{proposal.env}</strong>
        </span>
        <span className={`badge badge-${proposal.env}`}>{proposal.env}</span>
      </header>
      <table className="diff">
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Now</th>
            <th scope="col">After</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((change) => (
            <tr key={change.field}>
              <th scope="row">{FIELD_LABELS[change.field]}</th>
              <td className="before">{formatValue(change, "before")}</td>
              <td className="after">{formatValue(change, "after")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Reason: {proposal.reason}</p>

      {state.kind === "pending" || state.kind === "busy" ? (
        <div className="card-actions">
          <button type="button" onClick={() => act("confirm")} disabled={state.kind === "busy"}>
            Confirm
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => act("discard")}
            disabled={state.kind === "busy"}
          >
            Discard
          </button>
          <span className="muted">Expires at {expires}</span>
        </div>
      ) : (
        <p className={`status status-${state.kind}`} role="status">
          {state.kind === "confirmed" && "Applied. The flag table is updated."}
          {state.kind === "discarded" && "Discarded. Nothing changed."}
          {state.kind === "failed" && state.message}
        </p>
      )}
    </section>
  );
}
