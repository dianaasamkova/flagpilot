"use client";
// The assistant panel (FP-21): sends a message, reads the event stream, and shows text,
// tool activity, proposal cards and error states as they arrive.
import type { AssistantErrorCode, Proposal, ToolName } from "@flagpilot/domain";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { readEventStream } from "../lib/client/stream.ts";
import { ProposalCard } from "./ProposalCard.tsx";

type Item =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; id: string; name: ToolName; ok?: boolean }
  | { kind: "proposal"; proposal: Proposal }
  | { kind: "error"; code: AssistantErrorCode | "request"; message: string }
  | { kind: "interrupted"; retryText: string };

const TOOL_LABELS: Record<ToolName, string> = {
  list_flags: "Looking up flags",
  get_flag: "Reading the flag",
  propose_flag_change: "Preparing a change",
  explain_flag_history: "Reading the history",
};

export function AssistantPanel({ prompts }: { prompts: readonly string[] }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  /** Adds text to the last assistant bubble, or starts a new one. */
  const appendText = (text: string) =>
    setItems((current) => {
      const last = current.at(-1);
      if (last?.kind === "assistant") {
        return [...current.slice(0, -1), { kind: "assistant", text: last.text + text }];
      }
      return [...current, { kind: "assistant", text }];
    });
  const add = (item: Item) => setItems((current) => [...current, item]);

  async function send(text: string) {
    if (busy || text.trim() === "") return;
    setBusy(true);
    setDraft("");
    add({ kind: "user", text });
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok || response.body === null) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        add({ kind: "error", code: "request", message: body.message ?? "The request failed." });
        return;
      }
      const { completed } = await readEventStream(response.body, (event) => {
        switch (event.type) {
          case "text_delta":
            appendText(event.text);
            break;
          case "tool_started":
            add({ kind: "tool", id: event.id, name: event.name });
            break;
          case "tool_result":
            // Only the latest tool line with this id: a model may reuse ids across turns
            setItems((current) => {
              const index = current.findLastIndex(
                (item) => item.kind === "tool" && item.id === event.id,
              );
              const item = current[index];
              if (item?.kind !== "tool") return current;
              return current.with(index, { ...item, ok: event.ok });
            });
            break;
          case "proposal":
            add({ kind: "proposal", proposal: event.proposal });
            break;
          case "error":
            add({ kind: "error", code: event.code, message: event.message });
            break;
          case "done":
            break;
        }
      });
      // No "done" event: the stream was cut off (FP-29). A card that arrived stays valid.
      if (!completed) add({ kind: "interrupted", retryText: text });
    } catch {
      add({ kind: "interrupted", retryText: text });
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  return (
    <aside className="assistant" aria-label="Assistant">
      <h2>Assistant</h2>
      <div className="messages" aria-live="polite">
        {items.length === 0 && (
          <p className="muted">
            Ask about flags or request a change. Nothing changes until you click Confirm.
          </p>
        )}
        {items.map((item, index) => {
          switch (item.kind) {
            case "user":
              return (
                <p key={index} className="bubble bubble-user">
                  {item.text}
                </p>
              );
            case "assistant":
              return (
                <p key={index} className="bubble bubble-assistant">
                  {item.text}
                </p>
              );
            case "tool":
              return (
                <p key={index} className="tool muted">
                  {TOOL_LABELS[item.name]}
                  {item.ok === undefined ? "…" : item.ok ? " ✓" : " (failed)"}
                </p>
              );
            case "proposal":
              return (
                <ProposalCard
                  key={index}
                  proposal={item.proposal}
                  onApplied={() => router.refresh()}
                />
              );
            case "error":
              return (
                <p key={index} className="bubble bubble-error" role="alert">
                  {item.message}
                </p>
              );
            case "interrupted":
              return (
                <p key={index} className="bubble bubble-error" role="alert">
                  The answer was interrupted.{" "}
                  <button type="button" className="link" onClick={() => send(item.retryText)}>
                    Retry
                  </button>
                </p>
              );
          }
        })}
      </div>

      <div className="prompts">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="chip"
            disabled={busy}
            onClick={() => send(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
      <form className="composer" onSubmit={onSubmit}>
        <label htmlFor="assistant-input" className="visually-hidden">
          Message
        </label>
        <input
          id="assistant-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="e.g. Turn on search-semantic-ranking in staging"
          maxLength={1000}
          disabled={busy}
        />
        <button type="submit" disabled={busy || draft.trim() === ""}>
          {busy ? "…" : "Send"}
        </button>
      </form>
    </aside>
  );
}
