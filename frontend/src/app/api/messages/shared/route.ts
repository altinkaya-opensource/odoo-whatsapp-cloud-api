import { NextRequest, NextResponse } from "next/server";
import {
  odooErrorResponse,
  parseId,
  requireSession,
} from "@/app/lib/odoo/server";
import type { OdooMessageRecord } from "@/app/lib/whatsapp/records";
import {
  isSharedKind,
  SHARED_PAGE_SIZE,
  type SharedKind,
} from "@/app/lib/whatsapp/shared-content";

const MESSAGE_FIELDS = [
  "body",
  "direction",
  "attachment_id",
  "create_uid",
  "timestamp",
];

type DomainTerm = "|" | [string, string, string | number | boolean];

// The same split as isSharedIn(). The attachment terms join ir.attachment
// (auto_join on attachment_id) instead of searching every attachment.
const KIND_DOMAINS: Record<SharedKind, DomainTerm[]> = {
  media: [
    "|",
    ["attachment_id.mimetype", "=like", "image/%"],
    ["attachment_id.mimetype", "=like", "video/%"],
  ],
  files: [
    ["attachment_id", "!=", false],
    ["attachment_id.mimetype", "not like", "image/"],
    ["attachment_id.mimetype", "not like", "video/"],
  ],
  links: ["|", ["body", "ilike", "http"], ["body", "ilike", "www."]],
};

/**
 * A page of the photos and videos, files or messages with links of a
 * thread, newest first. Odoo's record rules decide which threads it reads.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ("response" in auth) {
    return auth.response;
  }

  const params = request.nextUrl.searchParams;
  const threadId = parseId(params.get("threadId"));
  const kind = params.get("kind");
  const beforeParam = params.get("beforeId");
  const beforeId = beforeParam ? parseId(beforeParam) : null;
  if (!threadId || !isSharedKind(kind) || (beforeParam && !beforeId)) {
    return NextResponse.json(
      {
        error:
          "threadId and kind (media, files or links) are required, beforeId must be an id",
      },
      { status: 400 }
    );
  }

  const domain: DomainTerm[] = [
    ["thread_id", "=", threadId],
    ...KIND_DOMAINS[kind],
  ];
  if (beforeId) {
    domain.push(["id", "<", beforeId]);
  }

  try {
    const messages = await auth.session.searchRead<OdooMessageRecord[]>(
      "whatsapp.message",
      domain,
      { limit: SHARED_PAGE_SIZE, order: "id DESC", select: MESSAGE_FIELDS }
    );
    return NextResponse.json({ messages: messages ?? [] });
  } catch (error) {
    return odooErrorResponse(error, "Failed to load the chat's shared items");
  }
}
