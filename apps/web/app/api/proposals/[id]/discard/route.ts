// POST /api/proposals/:id/discard: the human's Discard click.
import { discardProposal } from "@flagpilot/db";
import { sessionFromRequest, sessionHeaders } from "../../../../../lib/server/session.ts";

const ERRORS = {
  not_found: { status: 404, message: "This proposal doesn't exist." },
  not_creator: {
    status: 403,
    message: "Only the person who asked for this change can discard it.",
  },
  not_pending: { status: 409, message: "This proposal was already confirmed or discarded." },
} as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const session = sessionFromRequest(request);
  const headers = sessionHeaders(session);

  const result = await discardProposal(session.sandbox.store, session.user, id);
  if (!result.ok) {
    const { status, message } = ERRORS[result.error];
    return Response.json({ error: result.error, message }, { status, headers });
  }
  return Response.json({ ok: true }, { headers });
}
