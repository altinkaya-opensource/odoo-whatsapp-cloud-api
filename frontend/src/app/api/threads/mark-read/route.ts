import { NextRequest, NextResponse } from "next/server";
import {
  invalidBody,
  odooErrorResponse,
  parseId,
  readJsonBody,
  requireSession,
} from "@/app/lib/odoo/server";

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ("response" in auth) {
    return auth.response;
  }
  const sessionClient = auth.session;

  const body = await readJsonBody(request);
  if (!body) {
    return invalidBody();
  }
  const threadId = parseId(body.threadId);
  if (!threadId) {
    return NextResponse.json({ error: "Missing threadId" }, { status: 400 });
  }

  try {
    // Call mark_as_read on the thread record (instance method)
    const result = await sessionClient.call(
      "whatsapp.thread",
      "mark_as_read",
      [threadId],
      {}, // kwargs required
      false // Don't wrap args - pass record ID directly
    );

    return NextResponse.json({ success: true, result });
  } catch (error) {
    return odooErrorResponse(error, "Failed to mark thread as read");
  }
}
