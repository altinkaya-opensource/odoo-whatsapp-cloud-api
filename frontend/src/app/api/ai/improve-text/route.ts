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
import {
  CONTEXT_MESSAGES,
  formatConversation,
  loadConversation,
  MAX_INPUT_CHARS,
} from "@/app/lib/ai/conversation";

const IMPROVE_PROMPT = `You are a helpful assistant that improves WhatsApp messages. The user will provide you with:
1. Recent conversation context (last ${CONTEXT_MESSAGES} messages)
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
- Return ONLY the improved message text, nothing else`;

const GENERATE_PROMPT = `You are a helpful assistant that generates WhatsApp message replies based on conversation history. The user will provide you with recent conversation context (last ${CONTEXT_MESSAGES} messages).

IMPORTANT RULES:
- This is for WhatsApp - keep it SHORT and casual
- Maximum 1-2 sentences (prefer 1 sentence)
- Generate a natural, appropriate response
- Match the tone and style of the user's previous messages
- Keep it conversational and friendly
- DO NOT write long paragraphs
- DO NOT be overly formal or verbose
- Return ONLY the generated message text, nothing else`;

/**
 * Improve the draft, or write a reply when there is none, from the end of
 * the thread as Odoo has it.
 */
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

    const context = formatConversation(conversation.messages, {
      user: "User",
      contact: "Contact",
    });
    const userPrompt = currentText
      ? `Here is the recent conversation context:

${context}

Please improve the following message:
${currentText}`
      : `Here is the recent conversation context:

${context}

Please generate an appropriate response message based on this conversation.`;

    return await streamChatCompletion(
      openai,
      currentText ? IMPROVE_PROMPT : GENERATE_PROMPT,
      userPrompt
    );
  } catch (error) {
    return odooErrorResponse(error, "Failed to improve text");
  }
}
