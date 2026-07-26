import { NextRequest } from "next/server";
import {
  createOpenAIClient,
  isAIEnabled,
  getOpenAIModel,
} from "@/app/lib/ai/openai-client";
import { Message } from "@/app/context/chats-provider";

type TranslateRequest = {
  messages: Message[];
  currentText: string;
};

export async function POST(request: NextRequest) {
  try {
    // Check if AI feature is enabled
    if (!isAIEnabled()) {
      return new Response(
        JSON.stringify({ error: "AI feature is not enabled" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    const auth = await requireSession(request);
    if ("response" in auth) {
      return auth.response;
    }

    // Parse request body
    const body: TranslateRequest = await request.json();
    const { messages, currentText } = body;

    // Validate inputs
    if (!currentText || currentText.trim().length === 0) {
      return new Response(JSON.stringify({ error: "No text to translate" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "No conversation context available" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Create OpenAI client
    const openai = createOpenAIClient();
    if (!openai) {
      return new Response(
        JSON.stringify({ error: "OpenAI client configuration is missing" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Prepare conversation context (last 10 messages from contact only)
    const last10Messages = messages.slice(-10);
    const contactMessages = last10Messages
      .filter((msg) => !msg.isSentFromUser)
      .map((msg) => msg.message)
      .join("\n");

    // System prompt for translation
    const systemPrompt = `You are a translation assistant for WhatsApp messages. Analyze the conversation history to detect the customer's language, then translate the given text to that language.

IMPORTANT RULES:
- Detect the language from the customer's messages (NOT the user's messages)
- Translate ONLY the provided text to the customer's detected language
- Keep the translation natural and conversational for WhatsApp
- Maintain the same tone and style
- DO NOT add any extra text or explanations
- DO NOT improve or modify the meaning
- Return ONLY the translated text, nothing else
- If the text is already in the customer's language, return it unchanged`;

    // User prompt
    const userPrompt = `Customer's recent messages:
${contactMessages}

Text to translate:
${currentText}

Translate the text to the customer's language.`;

    // Call OpenAI API with streaming
    const stream = await openai.chat.completions.create({
      model: getOpenAIModel(),
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      max_completion_tokens: 500,
      stream: true,
    });

    // Create a readable stream for the response
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
          console.error("Streaming error:", error);
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
  } catch (error) {
    console.error("AI translate error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return new Response(
      JSON.stringify({ error: `Failed to translate: ${errorMessage}` }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
