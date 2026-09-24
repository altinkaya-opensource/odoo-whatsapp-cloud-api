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
  const templateId = parseId(payload.templateId);
  if (!templateId) {
    return NextResponse.json(
      { error: "templateId must be a positive number" },
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
      "send_simple_template",
      [recipient.backendId, recipient.phoneNumber, templateId],
      {},
      false
    );

    return NextResponse.json({ result, threadId });
  } catch (error) {
    return odooErrorResponse(error, "Failed to send template via Odoo");
  }
}
