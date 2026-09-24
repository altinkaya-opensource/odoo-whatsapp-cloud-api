import { NextRequest, NextResponse } from "next/server";
import {
  invalidBody,
  odooErrorResponse,
  parseId,
  readJsonBody,
  requireAgent,
  threadNotFound,
} from "@/app/lib/odoo/server";
import {
  createOpenAIClient,
  isAIEnabled,
  streamChatCompletion,
} from "@/app/lib/ai/openai-client";
import { loadConversation, MAX_INPUT_CHARS } from "@/app/lib/ai/conversation";

const SYSTEM_PROMPT = `You are a translation assistant for WhatsApp messages. Analyze the conversation history to detect the customer's language, then translate the given text to that language.

IMPORTANT RULES:
- Detect the language from the customer's messages (NOT the user's messages)
- Translate ONLY the provided text to the customer's detected language
- Keep the translation natural and conversational for WhatsApp
- Maintain the same tone and style
- DO NOT add any extra text or explanations
- DO NOT improve or modify the meaning
- Return ONLY the translated text, nothing else
- If the text is already in the customer's language, return it unchanged`;

/** Translate the draft into the language the customer writes in. */
export async function POST(request: NextRequest) {
  if (!isAIEnabled()) {
    return NextResponse.json(
      { error: "AI feature is not enabled" },
      { status: 403 }
    );
  }

  const auth = await requireAgent(request);
  if ("response" in auth) {
    return auth.response;
  }

  const body = await readJsonBody(request);
  if (!body) {
    return invalidBody();
  }
  const threadId = parseId(body.threadId);
  if (!threadId) {
    return NextResponse.json(
      { error: "threadId must be a valid number" },
      { status: 400 }
    );
  }
  const currentText =
    typeof body.currentText === "string" ? body.currentText.trim() : "";
  if (!currentText) {
    return NextResponse.json(
      { error: "No text to translate" },
      { status: 400 }
    );
  }
  if (currentText.length > MAX_INPUT_CHARS) {
    return NextResponse.json({ error: "Text is too long" }, { status: 413 });
  }

  const openai = createOpenAIClient();
  if (!openai) {
    return NextResponse.json(
      { error: "OpenAI client configuration is missing" },
      { status: 500 }
    );
  }

  try {
    const conversation = await loadConversation(auth.session, threadId);
    if (!conversation) {
      return threadNotFound();
    }
    if (conversation.messages.length === 0) {
      return NextResponse.json(
        { error: "No conversation context available" },
        { status: 400 }
      );
    }
    const contactMessages = conversation.messages
      .filter((message) => !message.isSentFromUser)
      .map((message) => message.text)
      .join("\n");

    const userPrompt = `Customer's recent messages:
${contactMessages}

Text to translate:
${currentText}

Translate the text to the customer's language.`;

    return await streamChatCompletion(openai, SYSTEM_PROMPT, userPrompt);
  } catch (error) {
    return odooErrorResponse(error, "Failed to translate");
  }
}
