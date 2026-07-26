import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/app/lib/odoo/server";
import {
  createOpenAIClient,
  isAIEnabled,
  getOpenAIModel,
} from "@/app/lib/ai/openai-client";
import { Message } from "@/app/context/chats-provider";

type ImproveTextRequest = {
  messages: Message[];
  currentText: string;
  systemPrompt?: string;
};

export async function POST(request: NextRequest) {
  try {
    // Check if AI feature is enabled
    if (!isAIEnabled()) {
      return NextResponse.json(
        { error: "AI feature is not enabled" },
        { status: 403 }
      );
    }

    const auth = await requireSession(request);
    if ("response" in auth) {
      return auth.response;
    }

    // Parse request body
    const body: ImproveTextRequest = await request.json();
    const { messages, currentText, systemPrompt } = body;

    // Validate that there are messages to work with
    if (!messages || messages.length === 0) {
      return NextResponse.json(
        { error: "No conversation context available" },
        { status: 400 }
      );
    }

    // Create OpenAI client
    const openai = createOpenAIClient();
    if (!openai) {
      return NextResponse.json(
        { error: "OpenAI client configuration is missing" },
        { status: 500 }
      );
    }

    // Prepare conversation context (last 10 messages)
    const last10Messages = messages.slice(-10);
    const conversationContext = last10Messages
      .map((msg) => {
        const sender = msg.isSentFromUser ? "User" : "Contact";
        return `${sender}: ${msg.message}`;
      })
      .join("\n");

    // Determine if we're improving existing text or generating a new message
    const hasCurrentText = currentText && currentText.trim().length > 0;

    // Default system prompt if not provided
    const defaultSystemPrompt = hasCurrentText
      ? `You are a helpful assistant that improves WhatsApp messages. The user will provide you with:
1. Recent conversation context (last 10 messages)
2. A draft message they want to improve

IMPORTANT RULES:
- This is for WhatsApp - keep it SHORT and casual
- Maximum 1-2 sentences (prefer 1 sentence)
- Fix grammar, spelling, and punctuation errors
- Make it clear and readable
- Keep the SAME tone and intent as the original
- DO NOT make it formal unless the original was formal
- DO NOT add extra information or explanations
- DO NOT make it longer than the original unless necessary for clarity
- Return ONLY the improved message text, nothing else`
      : `You are a helpful assistant that generates WhatsApp message replies based on conversation history. The user will provide you with recent conversation context (last 10 messages).

IMPORTANT RULES:
- This is for WhatsApp - keep it SHORT and casual
- Maximum 1-2 sentences (prefer 1 sentence)
- Generate a natural, appropriate response
- Match the tone and style of the user's previous messages
- Keep it conversational and friendly
- DO NOT write long paragraphs
- DO NOT be overly formal or verbose
- Return ONLY the generated message text, nothing else`;

    const finalSystemPrompt = systemPrompt || defaultSystemPrompt;

    // Prepare user prompt
    const userPrompt = hasCurrentText
      ? `Here is the recent conversation context:

${conversationContext}

Please improve the following message:
${currentText}`
      : `Here is the recent conversation context:

${conversationContext}

Please generate an appropriate response message based on this conversation.`;

    // Call OpenAI API with streaming
    const stream = await openai.chat.completions.create({
      model: getOpenAIModel(),
      messages: [
        {
          role: "system",
          content: finalSystemPrompt,
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
    console.error("AI improve text error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json(
      { error: `Failed to improve text: ${errorMessage}` },
      { status: 500 }
    );
  }
}
