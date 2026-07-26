import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/app/lib/odoo/server";
import {
  createOpenAIClient,
  isAIEnabled,
  getOpenAIModel,
} from "@/app/lib/ai/openai-client";

type TranslateMessageRequest = {
  text: string;
  targetLanguage: string; // "en" or "tr"
};

// Map language codes to full names for clearer prompts
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  tr: "Turkish",
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
    const body: TranslateMessageRequest = await request.json();
    const { text, targetLanguage } = body;

    // Validate inputs
    if (!text || text.trim().length === 0) {
      return NextResponse.json(
        { error: "No text to translate" },
        { status: 400 }
      );
    }

    if (!targetLanguage || !LANGUAGE_NAMES[targetLanguage]) {
      return NextResponse.json(
        { error: "Invalid target language" },
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

    const targetLanguageName = LANGUAGE_NAMES[targetLanguage];

    // System prompt for translation
    const systemPrompt = `You are a translation assistant. Translate the given message to ${targetLanguageName}.

IMPORTANT RULES:
- Translate the text to ${targetLanguageName}
- Keep the translation natural and conversational
- Maintain the same tone and style
- DO NOT add any extra text or explanations
- DO NOT improve or modify the meaning
- Return ONLY the translated text, nothing else
- If the text is already in ${targetLanguageName}, return it unchanged`;

    // Call OpenAI API (non-streaming for simplicity)
    const response = await openai.chat.completions.create({
      model: getOpenAIModel(),
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: text,
        },
      ],
      max_completion_tokens: 1000,
    });

    const translatedText =
      response.choices[0]?.message?.content?.trim() || text;

    return NextResponse.json({ translatedText });
  } catch (error) {
    console.error("AI translate-message error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json(
      { error: `Failed to translate: ${errorMessage}` },
      { status: 500 }
    );
  }
}
