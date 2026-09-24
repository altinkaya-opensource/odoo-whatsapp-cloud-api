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

// The Odoo send method for each kind of attachment; anything else, audio
// included, goes as a document
const SEND_METHODS = {
  image: "send_image_message",
  video: "send_video_message",
  document: "send_document_message",
} as const;

type AttachmentKind = keyof typeof SEND_METHODS;

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
  const attachmentId = parseId(payload.attachmentId);
  if (!attachmentId) {
    return NextResponse.json(
      { error: "attachmentId is required and must be a number" },
      { status: 400 }
    );
  }
  const kind: AttachmentKind =
    payload.kind === "image" || payload.kind === "video"
      ? payload.kind
      : "document";

  // Build kwargs
  const kwargs: { attachment: number; caption?: string; filename?: string } = {
    attachment: attachmentId,
  };
  if (typeof payload.caption === "string" && payload.caption) {
    kwargs.caption = payload.caption;
  }
  if (kind === "document" && typeof payload.filename === "string") {
    kwargs.filename = payload.filename;
  }

  try {
    const recipient = await getThreadRecipient(auth.session, threadId);
    if (!recipient) {
      return threadNotFound();
    }
    const result = await auth.session.call(
      "whatsapp.backend",
      SEND_METHODS[kind],
      [recipient.backendId, recipient.phoneNumber],
      kwargs,
      false
    );

    return NextResponse.json({ result, threadId });
  } catch (error) {
    return odooErrorResponse(error, "Failed to send attachment via Odoo");
  }
}
