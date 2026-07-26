import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/app/lib/odoo/server";
import {
  isAIEnabled,
  isRagEnabled,
  getRagChatUrl,
} from "@/app/lib/ai/openai-client";
import { ragSuggestionCache } from "@/app/lib/rag-suggestion-cache";
import { Message } from "@/app/context/chats-provider";

type RagSuggestionsRequest = {
  threadId: string;
  lastMessageId: string;
  messages: Message[];
  contactName?: string;
  userName?: string;
  forceRefresh?: boolean;
};

type RagApiResponse = {
  response: string;
};

/**
 * GET /api/ai/rag-suggestions?threadId=X&lastMessageId=Y
 * Returns cached suggestions if available
 */
export async function GET(request: NextRequest) {
  try {
    // Check if AI/RAG features are enabled
    if (!isAIEnabled() || !isRagEnabled()) {
      return NextResponse.json(
        { error: "AI/RAG feature is not enabled" },
        { status: 403 }
      );
    }

    const auth = await requireSession(request);
    if ("response" in auth) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get("threadId");
    const lastMessageId = searchParams.get("lastMessageId");

    if (!threadId || !lastMessageId) {
      return NextResponse.json(
        { error: "threadId and lastMessageId are required" },
        { status: 400 }
      );
    }

    // Check cache
    const cached = ragSuggestionCache.get(threadId, lastMessageId);

    if (cached && cached.length > 0) {
      // Cache hit
      return NextResponse.json({
        suggestions: cached,
        cached: true,
        cacheKey: `${threadId}:${lastMessageId}`,
      });
    }

    // Cache miss
    return NextResponse.json({
      suggestions: [],
      cached: false,
      cacheKey: `${threadId}:${lastMessageId}`,
    });
  } catch (error) {
    console.error("RAG suggestions GET error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json(
      { error: `Failed to get suggestions: ${errorMessage}` },
      { status: 500 }
    );
  }
}

/**
 * POST /api/ai/rag-suggestions
 * Generates new suggestions and caches them
 */
export async function POST(request: NextRequest) {
  try {
    // Check if AI/RAG features are enabled
    if (!isAIEnabled() || !isRagEnabled()) {
      return NextResponse.json(
        { error: "AI/RAG feature is not enabled" },
        { status: 403 }
      );
    }

    const auth = await requireSession(request);
    if ("response" in auth) {
      return auth.response;
    }

    // Parse request body
    const body: RagSuggestionsRequest = await request.json();
    const {
      threadId,
      lastMessageId,
      messages,
      contactName,
      userName,
      forceRefresh = false,
    } = body;

    // Validate required fields
    if (!threadId || !lastMessageId) {
      return NextResponse.json(
        { error: "threadId and lastMessageId are required" },
        { status: 400 }
      );
    }

    if (!messages || messages.length === 0) {
      return NextResponse.json(
        { error: "No conversation context available" },
        { status: 400 }
      );
    }

    // Check cache unless force refresh
    if (!forceRefresh) {
      const cached = ragSuggestionCache.get(threadId, lastMessageId);
      if (cached && cached.length > 0) {
        // Cache hit
        return NextResponse.json({
          suggestions: cached,
          cached: true,
          cacheKey: `${threadId}:${lastMessageId}`,
        });
      }
    } else {
      // Force refresh - invalidate existing cache
      ragSuggestionCache.invalidate(threadId, lastMessageId);
    }

    // Format messages for RAG endpoint
    const formattedMessages = messages
      .map((msg) => {
        if (msg.isSentFromUser) {
          const senderName = userName || "Support Agent";
          return `${senderName}(customer support): ${msg.message}`;
        } else {
          const customerName = contactName || "Customer";
          return `${customerName}: ${msg.message}`;
        }
      })
      .join("\n");

    const ragUrl = getRagChatUrl();
    if (!ragUrl) {
      return NextResponse.json(
        { error: "RAG URL is not configured" },
        { status: 500 }
      );
    }

    // Generate a single suggestion
    try {
      const response = await fetch(ragUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: formattedMessages,
        }),
      });

      if (!response.ok) {
        console.error("RAG API error:", response.status);
        return NextResponse.json({
          suggestions: [],
          cached: false,
          cacheKey: `${threadId}:${lastMessageId}`,
        });
      }

      const data: RagApiResponse = await response.json();
      // Filter out "NO_RESPONSE" - means the RAG system has no suggestion
      const suggestions =
        data.response &&
        data.response.length > 0 &&
        data.response !== "NO_RESPONSE"
          ? [data.response]
          : [];

      // Cache the result
      if (suggestions.length > 0) {
        ragSuggestionCache.set(threadId, lastMessageId, suggestions);
      }

      return NextResponse.json({
        suggestions,
        cached: false,
        cacheKey: `${threadId}:${lastMessageId}`,
      });
    } catch (error) {
      console.error("RAG generation failed:", error);
      return NextResponse.json({
        suggestions: [],
        cached: false,
        cacheKey: `${threadId}:${lastMessageId}`,
      });
    }
  } catch (error) {
    console.error("RAG suggestions POST error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json(
      { error: `Failed to generate suggestions: ${errorMessage}` },
      { status: 500 }
    );
  }
}
