// The agent loop (ADR-0004): model → tools → model … until the model answers.
// It validates every tool input with zod, retries bad input at most twice (FP-27),
// stops at a deadline and a maximum number of steps (FP-28), and streams AssistantEvents.
import {
  ExplainFlagHistoryInput,
  GetFlagInput,
  ListFlagsInput,
  ProposeFlagChangeInput,
  TOOL_INPUTS,
  type AssistantEvent,
  type Proposal,
  type ToolName,
  type User,
} from "@flagpilot/domain";
import type { Message, ModelClient, ModelEvent, ToolCall, ToolResult } from "@flagpilot/model";
import { z } from "zod";
import { buildSystemPrompt } from "./system-prompt.ts";
import { TOOL_DEFINITIONS, type ToolHandlers, type ToolOutcome } from "./tools.ts";

export type TurnLimits = {
  /** Model calls per turn. Stops a model that keeps calling tools forever. */
  maxIterations: number;
  /** Extra attempts after invalid tool input. 2 means: bad, bad, bad → fallback. */
  maxRetries: number;
  /** The whole turn must finish within this time. */
  deadlineMs: number;
};
export const DEFAULT_LIMITS: TurnLimits = { maxIterations: 6, maxRetries: 2, deadlineMs: 30_000 };

export type TurnOptions = {
  model: ModelClient;
  user: User;
  tools: ToolHandlers;
  /** The conversation so far. The loop appends this turn's messages to it, never edits. */
  messages: Message[];
  userText: string;
  /** Aborts when the browser disconnects. */
  signal?: AbortSignal;
  limits?: Partial<TurnLimits>;
};

export const FALLBACK_MESSAGE =
  'Sorry, I couldn\'t prepare that. Please rephrase it with the flag, environment and change, for example: "turn on checkout-one-page in staging".';

const FINISH_ERRORS = {
  max_tokens: {
    code: "max_tokens",
    message: "The answer was cut off because it got too long. Try a shorter request.",
  },
  refused: { code: "refused", message: "The model declined to answer this request." },
  quota: { code: "quota", message: "The free model quota is used up for now. Try again later." },
  model_error: { code: "model_error", message: "Something went wrong talking to the model." },
} as const;

/** What happened to one tool call. "invalid" counts towards the retry limit. */
type CallOutcome = { kind: "invalid"; message: string } | ({ kind: "ran" } & ToolOutcome);

/** Validates the input with the tool's schema, then runs the handler. */
async function validateAndRun<S extends z.ZodType>(
  name: ToolName,
  schema: S,
  args: unknown,
  handler: (input: z.output<S>) => Promise<ToolOutcome>,
): Promise<CallOutcome> {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    // The model reads this and tries again, so it must say exactly what to fix
    return {
      kind: "invalid",
      message: `Invalid input for ${name}:\n${z.prettifyError(parsed.error)}\nFix the input and call ${name} again.`,
    };
  }
  return { kind: "ran", ...(await handler(parsed.data)) };
}

function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOL_INPUTS, name);
}

/** Runs one tool call. A switch keeps each schema paired with its handler, type-checked. */
function runTool(call: ToolCall, tools: ToolHandlers): Promise<CallOutcome> {
  if (!isToolName(call.name)) {
    const names = Object.keys(TOOL_INPUTS).join(", ");
    return Promise.resolve({
      kind: "invalid",
      message: `Unknown tool "${call.name}". The tools are: ${names}.`,
    });
  }
  switch (call.name) {
    case "list_flags":
      return validateAndRun(call.name, ListFlagsInput, call.args, tools.list_flags);
    case "get_flag":
      return validateAndRun(call.name, GetFlagInput, call.args, tools.get_flag);
    case "propose_flag_change":
      return validateAndRun(
        call.name,
        ProposeFlagChangeInput,
        call.args,
        tools.propose_flag_change,
      );
    case "explain_flag_history":
      return validateAndRun(
        call.name,
        ExplainFlagHistoryInput,
        call.args,
        tools.explain_flag_history,
      );
  }
}

/** The text the model gets back for a tool call. */
function resultContent(outcome: CallOutcome): string {
  if (outcome.kind === "invalid") return outcome.message;
  return outcome.ok ? JSON.stringify(outcome.data) : outcome.message;
}

/** Turns a model's stop reason into the error event to show, or null for a normal end. */
function finishError(finish: Extract<ModelEvent, { type: "finish" }> | undefined) {
  if (finish === undefined) return FINISH_ERRORS.model_error; // stream ended without a finish
  switch (finish.reason) {
    case "end":
    case "tool_calls":
      return null;
    case "max_tokens":
      return FINISH_ERRORS.max_tokens;
    case "refused":
      return FINISH_ERRORS.refused;
    case "error":
      return finish.errorKind === "quota" ? FINISH_ERRORS.quota : FINISH_ERRORS.model_error;
  }
}

/** One user turn. Yields events for the browser; the last one is always "done". */
export async function* runAssistantTurn(options: TurnOptions): AsyncGenerator<AssistantEvent> {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const deadline = AbortSignal.timeout(limits.deadlineMs);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const { messages } = options;
  const system = buildSystemPrompt(options.user);
  messages.push({ role: "user", text: options.userText });

  // Model calls in a row that sent invalid tool input
  let invalidTurns = 0;

  try {
    for (let iteration = 0; iteration < limits.maxIterations; iteration += 1) {
      // 1. Stream the model's reply: pass text through, collect tool calls
      let text = "";
      const calls: ToolCall[] = [];
      let finish: Extract<ModelEvent, { type: "finish" }> | undefined;
      for await (const event of options.model.stream({
        system,
        messages,
        tools: TOOL_DEFINITIONS,
        signal,
      })) {
        if (event.type === "text_delta") {
          text += event.text;
          yield { type: "text_delta", text: event.text };
        } else if (event.type === "tool_call") {
          calls.push(event.call);
        } else {
          finish = event;
        }
      }
      // Append-only history: the reply goes back to the model exactly as it came
      messages.push({ role: "assistant", text, toolCalls: calls });

      // 2. Stop on a problem (cut off, refused, quota, error) or a normal answer
      const problem = finishError(finish);
      if (problem !== null) {
        yield { type: "error", ...problem };
        yield { type: "done" };
        return;
      }
      if (calls.length === 0) {
        yield { type: "done" };
        return;
      }

      // 3. Run every tool call; all results go back in one message
      const results: ToolResult[] = [];
      let anyInvalid = false;
      for (const call of calls) {
        // Unknown tool names only go back to the model; the browser never sees them
        const name = isToolName(call.name) ? call.name : undefined;
        if (name) yield { type: "tool_started", id: call.id, name };
        const outcome = await runTool(call, options.tools);
        const ok = outcome.kind === "ran" && outcome.ok;
        if (outcome.kind === "invalid") anyInvalid = true;
        if (name) yield { type: "tool_result", id: call.id, name, ok };
        const proposal: Proposal | undefined =
          outcome.kind === "ran" && outcome.ok ? outcome.proposal : undefined;
        if (proposal) yield { type: "proposal", proposal };
        results.push({
          callId: call.id,
          name: call.name,
          isError: !ok,
          content: resultContent(outcome),
        });
      }
      messages.push({ role: "tool", results });

      // 4. The retry rule: invalid input goes back to the model as an error result
      //    (above), and it may try again, but at most maxRetries times in a row
      if (anyInvalid) {
        invalidTurns += 1;
        if (invalidTurns > limits.maxRetries) {
          yield { type: "error", code: "invalid_tool_args", message: FALLBACK_MESSAGE };
          yield { type: "done" };
          return;
        }
      } else {
        invalidTurns = 0;
      }
    }

    yield {
      type: "error",
      code: "max_iterations",
      message: "That took too many steps. Try a simpler request.",
    };
    yield { type: "done" };
  } catch (error) {
    // The browser disconnected: nobody is listening, so stop quietly
    if (options.signal?.aborted) return;
    if (deadline.aborted) {
      yield { type: "error", code: "timeout", message: "That took too long. Please try again." };
    } else {
      console.error("assistant turn failed", error);
      yield { type: "error", ...FINISH_ERRORS.model_error };
    }
    yield { type: "done" };
  }
}
