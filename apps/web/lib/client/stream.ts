// Reads the assistant's NDJSON stream in the browser (FP-21). Each complete line is
// parsed with the shared AssistantEvent schema; a line that doesn't parse is skipped.
import { decodeEvent, type AssistantEvent } from "@flagpilot/domain";

/**
 * Calls onEvent for each event as it arrives. Resolves with completed: true when the
 * stream sent "done". A stream that ends without it was interrupted (FP-29).
 */
export async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: AssistantEvent) => void,
): Promise<{ completed: boolean }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

  const handleLine = (line: string) => {
    if (line.trim() === "") return;
    const event = decodeEvent(line);
    if (event === null) return;
    if (event.type === "done") completed = true;
    onEvent(event);
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      // A chunk can end in the middle of a line: keep the unfinished part for later
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(handleLine);
    }
    handleLine(buffer + decoder.decode());
  } catch {
    // Network error mid-stream: report it as interrupted
  }
  return { completed };
}
