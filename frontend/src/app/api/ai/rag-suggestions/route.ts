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
  AI_TIMEOUT_MS,
  getRagChatUrl,
  isAIEnabled,
  isRagEnabled,
} from "@/app/lib/ai/openai-client";
import {
  formatConversation,
  loadConversation,
} from "@/app/lib/ai/conversation";
import { ragSuggestionCache } from "@/app/lib/rag-suggestion-cache";

type RagApiResponse = {
  response: string;
};

/**
 * POST /api/ai/rag-suggestions { threadId, forceRefresh? }
 *
 * A reply suggestion for the customer's latest message. Suggestions are
 * shared by everyone who opens the thread, so the conversation is read from
 * Odoo with the user's rights, never taken from the browser.
 */
export async function POST(request: NextRequest) {
  if (!isAIEnabled() || !isRagEnabled()) {
    return NextResponse.json(
      { error: "AI/RAG feature is not enabled" },
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
  const forceRefresh = body.forceRefresh === true;

  try {
    const conversation = await loadConversation(auth.session, threadId);
    if (!conversation) {
      return threadNotFound();
    }
    const lastIncoming = conversation.messages.findLast(
      (message) => !message.isSentFromUser
    );
    if (!lastIncoming) {
      return NextResponse.json({ suggestions: [], cached: false });
    }

    const threadKey = String(threadId);
    const messageKey = String(lastIncoming.id);
    if (forceRefresh) {
      ragSuggestionCache.invalidate(threadKey, messageKey);
    } else {
      const cached = ragSuggestionCache.get(threadKey, messageKey);
      if (cached && cached.length > 0) {
        return NextResponse.json({ suggestions: cached, cached: true });
      }
    }

    const response = await fetch(getRagChatUrl() as string, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: formatConversation(conversation.messages, {
          user: "Support Agent(customer support)",
          contact: conversation.contactName,
        }),
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error("[RAG] Suggestion request failed:", response.status);
      return NextResponse.json({ suggestions: [], cached: false });
    }

    const data: RagApiResponse = await response.json();
    // "NO_RESPONSE" means the RAG system has no suggestion
    const suggestions =
      data.response && data.response !== "NO_RESPONSE" ? [data.response] : [];
    if (suggestions.length > 0) {
      ragSuggestionCache.set(threadKey, messageKey, suggestions);
    }

    return NextResponse.json({ suggestions, cached: false });
  } catch (error) {
    return odooErrorResponse(error, "Failed to generate suggestions");
  }
}
