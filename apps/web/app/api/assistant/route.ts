// POST /api/assistant: one user message in, a stream of AssistantEvents out (NDJSON).
// The browser never talks to the model; only this server does (ADR-0004).
import { encodeEvent, type AssistantEvent } from "@flagpilot/domain";
import { z } from "zod";
import { runAssistantTurn } from "../../../lib/assistant/loop.ts";
import { createToolHandlers } from "../../../lib/assistant/tools.ts";
import { createModelClient } from "../../../lib/server/model.ts";
import { sessionFromRequest, sessionHeaders } from "../../../lib/server/session.ts";

const Body = z.strictObject({ text: z.string().trim().min(1).max(1000) });

/** Turns the loop's events into a byte stream. Cancelling it stops the loop. */
function toNdjsonStream(events: AsyncGenerator<AssistantEvent>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async pull(controller) {
      const next = await events.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(encodeEvent(next.value)));
    },
    async cancel() {
      await events.return(undefined);
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const session = sessionFromRequest(request);
  const headers = sessionHeaders(session);

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json(
      { error: "bad_request", message: "Send { text } with 1–1000 characters." },
      { status: 400, headers },
    );
  }

  const { user, sandbox } = session;
  const events = runAssistantTurn({
    model: createModelClient(),
    user,
    tools: createToolHandlers(sandbox.store, user),
    messages: sandbox.conversation(user.id),
    userText: body.data.text,
    // The browser closing the request aborts the model call (FP-28)
    signal: request.signal,
  });

  return new Response(toNdjsonStream(events), {
    headers: {
      ...headers,
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
