import { NextRequest, NextResponse } from "next/server";
import {
  invalidBody,
  odooErrorResponse,
  parseId,
  readJsonBody,
  requireSession,
} from "@/app/lib/odoo/server";

/** Tell the backend's other users that this user started or stopped typing. */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ("response" in auth) {
    return auth.response;
  }

  const body = await readJsonBody(request);
  if (!body) {
    return invalidBody();
  }
  const threadId = parseId(body.threadId);
  if (!threadId) {
    return NextResponse.json({ error: "Missing threadId" }, { status: 400 });
  }

  try {
    await auth.session.call(
      "whatsapp.thread",
      "notify_typing",
      [threadId, body.isTyping === true],
      {},
      false
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return odooErrorResponse(error, "Failed to notify typing");
  }
}
