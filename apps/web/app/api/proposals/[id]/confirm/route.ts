// POST /api/proposals/:id/confirm: the human's Confirm click (ADR-0002, FP-25).
// Not a tool: the model can't call it. confirmProposal re-checks everything.
import { confirmProposal } from "@flagpilot/db";
import { CONFIRM_ERRORS } from "@flagpilot/domain";
import { sessionFromRequest, sessionHeaders } from "../../../../../lib/server/session.ts";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const session = sessionFromRequest(request);
  const headers = sessionHeaders(session);

  const result = await confirmProposal(session.sandbox.store, session.user, id);
  if (!result.ok) {
    const { status, message } = CONFIRM_ERRORS[result.error];
    return Response.json({ error: result.error, message }, { status, headers });
  }
  return Response.json({ ok: true, event: result.value }, { headers });
}
