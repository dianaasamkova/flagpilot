// The Gemini adapter (ADR-0005, ADR-0007, FP-19). It translates our ModelClient types to
// Gemini's generateContent API and Gemini's streamed chunks back to our ModelEvents.
// Every Gemini type stays in this file; the loop never sees one.
import {
  ApiError,
  GoogleGenAI,
  ThinkingLevel,
  type Content,
  type FunctionDeclaration,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";
import type {
  Message,
  ModelClient,
  ModelEvent,
  ModelRequest,
  ToolCall,
  ToolDefinition,
} from "./types.ts";

/** Newest stable Flash on the free tier (ADR-0007). GEMINI_MODEL overrides it. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

/** Thinking tokens count against this limit too, so it isn't set lower (ADR-0007). */
export const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

/** The one SDK call the adapter makes. Tests replace it with recorded chunks. */
export type GenerateStream = (
  params: GenerateContentParameters,
) => Promise<AsyncIterable<GenerateContentResponse>>;

export type GeminiOptions = {
  apiKey: string;
  model?: string;
  maxOutputTokens?: number;
  /** Replaces the real SDK call, for tests and the recording script. */
  generate?: GenerateStream;
};

// Ids the adapter made up because Gemini sent none. They never go back to Gemini.
const LOCAL_ID_PREFIX = "gemini-local-";

// Finish reasons where Gemini's safety or policy filters stopped the answer
const REFUSED = new Set([
  "SAFETY",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "RECITATION",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
  "IMAGE_RECITATION",
]);

export class GeminiModelClient implements ModelClient {
  readonly model: string;
  private readonly maxOutputTokens: number;
  private readonly generate: GenerateStream;

  constructor(options: GeminiOptions) {
    this.model = options.model ?? DEFAULT_GEMINI_MODEL;
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    if (options.generate) {
      this.generate = options.generate;
    } else {
      const ai = new GoogleGenAI({ apiKey: options.apiKey });
      this.generate = (params) => ai.models.generateContentStream(params);
    }
  }

  async *stream(request: ModelRequest): AsyncGenerator<ModelEvent> {
    const callIds = new Set<string>();
    let finishReason: string | undefined;
    let blocked = false;

    try {
      const chunks = await this.generate(
        toGeminiRequest(this.model, this.maxOutputTokens, request),
      );
      for await (const chunk of chunks) {
        if (chunk.promptFeedback?.blockReason) blocked = true;
        const candidate = chunk.candidates?.[0];
        for (const part of candidate?.content?.parts ?? []) {
          // Hidden reasoning never reaches the user
          if (part.thought) continue;
          if (part.functionCall) {
            const call = toToolCall(part, callIds);
            callIds.add(call.id);
            yield { type: "tool_call", call };
          } else if (part.text) {
            yield { type: "text_delta", text: part.text };
          }
        }
        if (candidate?.finishReason) finishReason = candidate.finishReason;
      }
    } catch (error) {
      // Aborted (deadline or disconnect): rethrow, so the loop can tell which one it was
      if (request.signal.aborted) throw request.signal.reason;
      yield errorFinish(error);
      return;
    }

    yield finishEvent(blocked, finishReason, callIds.size);
  }
}

/** Builds the generateContent request from ours. Exported for tests. */
export function toGeminiRequest(
  model: string,
  maxOutputTokens: number,
  request: ModelRequest,
): GenerateContentParameters {
  return {
    model,
    contents: toContents(request.messages),
    config: {
      systemInstruction: request.system,
      ...(request.tools.length > 0 && {
        tools: [{ functionDeclarations: request.tools.map(toDeclaration) }],
      }),
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      maxOutputTokens,
      abortSignal: request.signal,
    },
  };
}

/** Our JSON Schema goes in as it is, minus "$schema", which isn't part of a tool's parameters. */
function toDeclaration(tool: ToolDefinition): FunctionDeclaration {
  const parameters = { ...tool.inputSchema };
  delete parameters.$schema;
  return { name: tool.name, description: tool.description, parametersJsonSchema: parameters };
}

/**
 * Our history → Gemini's contents. Gemini rejects empty content, so messages with nothing
 * to send are skipped, and messages in a row with the same role are merged into one.
 */
export function toContents(messages: readonly Message[]): Content[] {
  const contents: { role: "user" | "model"; parts: Part[] }[] = [];
  for (const message of messages) {
    const content = toContent(message);
    if (content.parts.length === 0) continue;
    const previous = contents.at(-1);
    if (previous?.role === content.role) previous.parts.push(...content.parts);
    else contents.push(content);
  }
  return contents;
}

function toContent(message: Message): { role: "user" | "model"; parts: Part[] } {
  switch (message.role) {
    case "user":
      return { role: "user", parts: [{ text: message.text }] };
    case "assistant":
      return {
        role: "model",
        parts: [
          ...(message.text ? [{ text: message.text }] : []),
          ...message.toolCalls.map(toFunctionCallPart),
        ],
      };
    case "tool":
      // Tool results go back as a "user" message with one functionResponse per call
      return {
        role: "user",
        parts: message.results.map((result) => ({
          functionResponse: {
            ...providerId(result.callId),
            name: result.name,
            response: result.isError ? { error: result.content } : { output: result.content },
          },
        })),
      };
  }
}

/** A call goes back exactly as Gemini sent it, with its thought signature (ADR-0007). */
function toFunctionCallPart(call: ToolCall): Part {
  return {
    functionCall: { ...providerId(call.id), name: call.name, args: asArgs(call.args) },
    ...(call.signature !== undefined && { thoughtSignature: call.signature }),
  };
}

/** Gemini's own call id, or nothing when the adapter made the id up. */
function providerId(id: string): { id?: string } {
  return id.startsWith(LOCAL_ID_PREFIX) ? {} : { id };
}

function asArgs(args: unknown): Record<string, unknown> {
  return typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
}

/** A functionCall part → our ToolCall. Makes an id when Gemini sends none or repeats one. */
function toToolCall(part: Part, usedIds: ReadonlySet<string>): ToolCall {
  const functionCall = part.functionCall ?? {};
  const id =
    functionCall.id && !usedIds.has(functionCall.id)
      ? functionCall.id
      : `${LOCAL_ID_PREFIX}${crypto.randomUUID()}`;
  return {
    id,
    name: functionCall.name ?? "",
    args: functionCall.args ?? {},
    ...(part.thoughtSignature !== undefined && { signature: part.thoughtSignature }),
  };
}

/** The finish event once the stream has ended. */
function finishEvent(
  blocked: boolean,
  reason: string | undefined,
  callCount: number,
): Extract<ModelEvent, { type: "finish" }> {
  if (blocked) return { type: "finish", reason: "refused" };
  if (reason === "STOP") return { type: "finish", reason: callCount > 0 ? "tool_calls" : "end" };
  if (reason === "MAX_TOKENS") return { type: "finish", reason: "max_tokens" };
  if (reason !== undefined && REFUSED.has(reason)) return { type: "finish", reason: "refused" };
  // MALFORMED_FUNCTION_CALL, OTHER, unknown, or no reason at all (a cut-off stream)
  return {
    type: "finish",
    reason: "error",
    errorKind: "other",
    message: `Gemini stopped with ${reason ?? "no finish reason"}.`,
  };
}

/** A failed request → a finish event. Running out of quota is a normal state (ADR-0005). */
function errorFinish(error: unknown): Extract<ModelEvent, { type: "finish" }> {
  if (error instanceof ApiError && error.status === 429) {
    return {
      type: "finish",
      reason: "error",
      errorKind: "quota",
      message: "Gemini quota used up.",
    };
  }
  // The server log gets the details; the event only says what kind of failure it was
  console.error("Gemini request failed", error);
  const status = error instanceof ApiError ? ` (status ${error.status})` : "";
  return {
    type: "finish",
    reason: "error",
    errorKind: "other",
    message: `Gemini request failed${status}.`,
  };
}
