/**
 * Read an AI route's event stream (`data: {"content": "..."}` lines, ended
 * by `data: [DONE]`), calling onText with the whole text so far each time it
 * grows. Resolves with the final text.
 */
export const readAiStream = async (
  response: Response,
  onText: (text: string) => void
): Promise<string> => {
  if (!response.ok || !response.body) {
    throw new Error(`AI request failed (${response.status})`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return text;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // The last piece may be a line cut in half: keep it for the next chunk
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const event = line.trim();
        if (!event.startsWith("data: ")) {
          continue;
        }
        const data = event.slice("data: ".length);
        if (data === "[DONE]") {
          return text;
        }
        try {
          const { content } = JSON.parse(data);
          if (typeof content === "string" && content) {
            text += content;
            onText(text);
          }
        } catch {
          // Not an event of ours
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
};
