import { NextRequest, NextResponse } from "next/server";
import {
  getThreadRecipient,
  invalidBody,
  odooErrorResponse,
  parseId,
  readJsonBody,
  requireSession,
  threadNotFound,
} from "@/app/lib/odoo/server";

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ("response" in auth) {
    return auth.response;
  }

  const payload = await readJsonBody(request);
  if (!payload) {
    return invalidBody();
  }
  const threadId = parseId(payload.threadId);
  if (!threadId) {
    return NextResponse.json(
      { error: "threadId must be a valid number" },
      { status: 400 }
    );
  }
  const { emoji, whatsappMessageId } = payload;
  if (!emoji || typeof emoji !== "string") {
    return NextResponse.json({ error: "emoji is required" }, { status: 400 });
  }
  if (!whatsappMessageId || typeof whatsappMessageId !== "string") {
    return NextResponse.json(
      { error: "whatsappMessageId is required" },
      { status: 400 }
    );
  }

  try {
    const recipient = await getThreadRecipient(auth.session, threadId);
    if (!recipient) {
      return threadNotFound();
    }
    const result = await auth.session.call(
      "whatsapp.backend",
      "send_reaction_message",
      [recipient.backendId, recipient.phoneNumber, emoji, whatsappMessageId],
      {},
      false
    );

    return NextResponse.json({ result });
  } catch (error) {
    return odooErrorResponse(error, "Failed to send reaction via Odoo");
  }
}
