import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/app/lib/odoo/server";
import {
  isAIEnabled,
  isRagEnabled,
  getRagChatUrl,
} from "@/app/lib/ai/openai-client";
import { Message } from "@/app/context/chats-provider";

type RagGenerateRequest = {
  messages: Message[];
  contactName?: string;
  userName?: string;
  style?: string;
};

type RagApiResponse = {
  response: string;
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

    // Check if RAG feature is enabled
    if (!isRagEnabled()) {
      return NextResponse.json(
        { error: "RAG feature is not configured" },
        { status: 403 }
      );
    }

    // Parse request body
    const body: RagGenerateRequest = await request.json();
    const { messages, contactName, userName, style } = body;

    // Validate that there are messages to work with
    if (!messages || messages.length === 0) {
      return NextResponse.json(
        { error: "No conversation context available" },
        { status: 400 }
      );
    }

    // Format messages for RAG endpoint
    // Format: "CustomerName: message\nSupportName(customer support): message"
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

    // Send request to RAG endpoint
    const ragResponse = await fetch(ragUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: formattedMessages,
        ...(style && { style }),
      }),
    });

    if (!ragResponse.ok) {
      const errorText = await ragResponse.text();
      console.error("RAG API error:", errorText);
      return NextResponse.json(
        { error: `RAG service error: ${ragResponse.status}` },
        { status: 502 }
      );
    }

    const ragData: RagApiResponse = await ragResponse.json();

    if (!ragData.response) {
      return NextResponse.json(
        { error: "RAG service returned empty response" },
        { status: 502 }
      );
    }

    return NextResponse.json({ response: ragData.response });
  } catch (error) {
    console.error("RAG generate error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json(
      { error: `Failed to generate response: ${errorMessage}` },
      { status: 500 }
    );
  }
}
