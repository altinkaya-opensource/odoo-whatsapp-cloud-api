import OpenAI from "openai";

/** How long an AI provider or the RAG service may take to answer. */
export const AI_TIMEOUT_MS = 30_000;

/**
 * Creates and returns an OpenAI client instance with configuration from environment variables
 */
export function createOpenAIClient(): OpenAI | null {
  const baseURL = process.env.OPENAI_BASE_URL;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!baseURL || !apiKey) {
    console.warn(
      "OpenAI configuration missing: OPENAI_BASE_URL or OPENAI_API_KEY not set"
    );
    return null;
  }

  // The SDK would wait ten minutes and retry twice
  return new OpenAI({
    baseURL,
    apiKey,
    timeout: AI_TIMEOUT_MS,
    maxRetries: 1,
  });
}

/**
 * Checks if AI chat improvement feature is enabled
 */
export function isAIEnabled(): boolean {
  return process.env.AI_CHAT_ENABLED === "true";
}

/**
 * Gets the configured OpenAI model name
 */
export function getOpenAIModel(): string {
  return process.env.OPENAI_MODEL || "openai/gpt-4o";
}

/**
 * Gets the configured RAG-supported chat URL
 */
export function getRagChatUrl(): string | null {
  return process.env.RAG_SUPPORTED_CHAT_URL || null;
}

/**
 * Checks if RAG-based AI response generation is enabled
 */
export function isRagEnabled(): boolean {
  const url = getRagChatUrl();
  return !!url && url.trim().length > 0;
}

/**
 * Stream a chat completion to the browser as `data: {"content": ...}` server
 * events, ending with `data: [DONE]`.
 */
export async function streamChatCompletion(
  openai: OpenAI,
  systemPrompt: string,
  userPrompt: string
): Promise<Response> {
  const stream = await openai.chat.completions.create({
    model: getOpenAIModel(),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_completion_tokens: 500,
    stream: true,
  });

  const encoder = new TextEncoder();
  const readableStream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            const data = `data: ${JSON.stringify({ content })}\n\n`;
            controller.enqueue(encoder.encode(data));
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        console.error("[AI] Streaming error:", error);
        controller.error(error);
      }
    },
  });

  return new Response(readableStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
