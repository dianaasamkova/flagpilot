// The API routes end to end, with the demo model and in-memory sandboxes.
import { decodeEvent, type AssistantEvent, type Proposal } from "@flagpilot/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as assistant } from "../../app/api/assistant/route.ts";
import { POST as confirm } from "../../app/api/proposals/[id]/confirm/route.ts";
import { POST as discard } from "../../app/api/proposals/[id]/discard/route.ts";
import { getSandbox, resetSandboxes } from "../../lib/server/session.ts";

beforeEach(() => resetSandboxes());

const SANDBOX = "11111111-2222-3333-4444-555555555555";
const OTHER_SANDBOX = "99999999-2222-3333-4444-555555555555";
const cookie = (userId = "u-editor", sandbox = SANDBOX) =>
  `fp_user=${userId}; fp_sandbox=${sandbox}`;

async function ask(text: string, cookieHeader: string | null = cookie()) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookieHeader) headers.cookie = cookieHeader;
  const response = await assistant(
    new Request("http://test/api/assistant", {
      method: "POST",
      headers,
      body: JSON.stringify({ text }),
    }),
  );
  const events = (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => decodeEvent(line))
    .filter((event): event is AssistantEvent => event !== null);
  return { response, events };
}

function proposalOf(events: AssistantEvent[]): Proposal {
  const event = events.find((item) => item.type === "proposal");
  if (event?.type !== "proposal") throw new Error("no proposal event");
  return event.proposal;
}

function act(route: typeof confirm, id: string, cookieHeader = cookie()) {
  return route(
    new Request(`http://test/api/proposals/${id}`, {
      method: "POST",
      headers: { cookie: cookieHeader },
    }),
    { params: Promise.resolve({ id }) },
  );
}

const rollout = async (sandbox = SANDBOX) =>
  (await getSandbox(sandbox).store.getFlag("checkout-one-page"))?.envs.staging.rolloutPercent;

describe("POST /api/assistant", () => {
  it("streams NDJSON events that end with done", async () => {
    const { response, events } = await ask("Which flags are on in production?");
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(events.map((event) => event.type)).toEqual([
      "tool_started",
      "tool_result",
      "text_delta",
      "done",
    ]);
  });

  it("starts a sandbox and sets its cookie for a new visitor", async () => {
    const { response } = await ask("list flags", null);
    expect(response.headers.get("set-cookie")).toMatch(
      /^fp_sandbox=[0-9a-f-]{36}; Path=\/; HttpOnly/,
    );
  });

  it("doesn't set a cookie when the visitor has a sandbox", async () => {
    const { response } = await ask("list flags");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects an empty message with 400", async () => {
    const { response } = await ask("   ");
    expect(response.status).toBe(400);
  });

  it("keeps the conversation per user between requests", async () => {
    await ask("list flags");
    await ask("list flags");
    expect(
      getSandbox(SANDBOX)
        .conversation("u-editor")
        .filter((m) => m.role === "user"),
    ).toHaveLength(2);
    expect(getSandbox(SANDBOX).conversation("u-admin")).toEqual([]);
  });
});

describe("propose → confirm through the routes", () => {
  it("proposes without changing, then confirm applies the change", async () => {
    const { events } = await ask("Set checkout-one-page to 80% in staging");
    const proposal = proposalOf(events);
    expect(await rollout()).toBe(50);

    const response = await act(confirm, proposal.id);
    expect(response.status).toBe(200);
    expect(await rollout()).toBe(80);
  });

  it("returns 409 for a second confirm", async () => {
    const proposal = proposalOf((await ask("Set checkout-one-page to 80% in staging")).events);
    await act(confirm, proposal.id);
    const response = await act(confirm, proposal.id);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "not_pending" });
  });

  it("returns 403 when another user confirms", async () => {
    const proposal = proposalOf((await ask("Set checkout-one-page to 80% in staging")).events);
    const response = await act(confirm, proposal.id, cookie("u-admin"));
    expect(response.status).toBe(403);
    expect(await rollout()).toBe(50);
  });

  it("returns 404 for a proposal from another sandbox", async () => {
    const proposal = proposalOf((await ask("Set checkout-one-page to 80% in staging")).events);
    const response = await act(confirm, proposal.id, cookie("u-editor", OTHER_SANDBOX));
    expect(response.status).toBe(404);
  });

  it("discard stops a later confirm", async () => {
    const proposal = proposalOf((await ask("Set checkout-one-page to 80% in staging")).events);
    expect((await act(discard, proposal.id)).status).toBe(200);
    expect((await act(confirm, proposal.id)).status).toBe(409);
    expect(await rollout()).toBe(50);
  });

  it("a viewer gets no proposal, only an explanation", async () => {
    const { events } = await ask("Set checkout-one-page to 80% in staging", cookie("u-viewer"));
    expect(events.some((event) => event.type === "proposal")).toBe(false);
    const text = events.flatMap((event) => (event.type === "text_delta" ? [event.text] : []));
    expect(text.join("")).toContain("Editors can change dev and staging");
  });

  it("an editor can't get a production proposal", async () => {
    const { events } = await ask("Turn on checkout-one-page in production");
    expect(events.some((event) => event.type === "proposal")).toBe(false);
  });
});

describe("sandboxes", () => {
  it("keep one visitor's changes away from another", async () => {
    const proposal = proposalOf((await ask("Set checkout-one-page to 80% in staging")).events);
    await act(confirm, proposal.id);
    expect(await rollout(SANDBOX)).toBe(80);
    expect(await rollout(OTHER_SANDBOX)).toBe(50);
  });
});
