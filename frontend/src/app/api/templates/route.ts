import { NextRequest, NextResponse } from "next/server";
import {
  getThreadRecipient,
  odooErrorResponse,
  parseId,
  requireSession,
  threadNotFound,
} from "@/app/lib/odoo/server";

export type SimpleTemplate = {
  id: number;
  name: string;
  language: string;
  category: string;
  header_text: string;
  body_text: string;
  footer_text: string;
  preview: string;
};

/** Templates that can be sent on a thread, from its backend's account. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ("response" in auth) {
    return auth.response;
  }

  const threadId = parseId(request.nextUrl.searchParams.get("threadId"));
  if (!threadId) {
    return NextResponse.json(
      { error: "threadId must be a valid number" },
      { status: 400 }
    );
  }

  try {
    const recipient = await getThreadRecipient(auth.session, threadId);
    if (!recipient) {
      return threadNotFound();
    }
    const templates = await auth.session.call<SimpleTemplate[]>(
      "whatsapp.backend",
      "get_simple_templates",
      [recipient.backendId],
      {},
      false
    );

    return NextResponse.json({ templates: templates ?? [] });
  } catch (error) {
    return odooErrorResponse(error, "Failed to fetch templates from Odoo");
  }
}
