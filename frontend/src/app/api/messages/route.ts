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

const MAX_LIMIT = 200;

const MESSAGE_FIELDS = [
  "create_date",
  "body",
  "status",
  "direction",
  "attachment_id",
  "create_uid",
  "message_id",
  "replied_message_id",
  "write_date",
  "timestamp",
  "reaction_emoji",
];

type OdooMessageRecord = {
  id: number;
  create_date: string;
  body: string | null;
  status: string | null;
  direction: "incoming" | "outgoing" | string;
  attachment_id: false | [number, string] | null;
  message_id?: string | null;
  replied_message_id?: false | [number, string] | null;
  timestamp: number;
  reaction_emoji?: string | false | null;
};

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ("response" in auth) {
    return auth.response;
  }
  const sessionClient = auth.session;

  const threadIdParam = request.nextUrl.searchParams.get("threadId");
  if (!threadIdParam) {
    return NextResponse.json(
      { error: "threadId query parameter is required" },
      { status: 400 }
    );
  }

  const threadId = Number(threadIdParam);
  if (Number.isNaN(threadId) || threadId <= 0) {
    return NextResponse.json(
      { error: "threadId must be a valid positive number" },
      { status: 400 }
    );
  }

  const limitParam = request.nextUrl.searchParams.get("limit");
  // Default to 30 if not specified (but frontend always sends 100)
  const limit = limitParam ? Number(limitParam) : 30;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_LIMIT) {
    return NextResponse.json(
      { error: `limit must be between 1 and ${MAX_LIMIT}` },
      { status: 400 }
    );
  }

  const lastIdParam = request.nextUrl.searchParams.get("lastId");
  const lastId =
    lastIdParam && lastIdParam.length > 0 ? Number(lastIdParam) : undefined;

  if (typeof lastId !== "undefined" && Number.isNaN(lastId)) {
    return NextResponse.json(
      { error: "lastId must be a valid number" },
      { status: 400 }
    );
  }

  const directionParam = request.nextUrl.searchParams.get("direction");
  const direction =
    directionParam === "backward" || directionParam === "forward"
      ? directionParam
      : undefined;

  if (
    typeof directionParam === "string" &&
    directionParam.length > 0 &&
    typeof direction === "undefined"
  ) {
    return NextResponse.json(
      { error: "direction must be 'forward' or 'backward'" },
      { status: 400 }
    );
  }

  const aroundIdParam = request.nextUrl.searchParams.get("aroundId");
  const aroundId =
    aroundIdParam && aroundIdParam.length > 0
      ? Number(aroundIdParam)
      : undefined;

  if (
    typeof aroundId !== "undefined" &&
    (Number.isNaN(aroundId) || aroundId <= 0)
  ) {
    return NextResponse.json(
      { error: "aroundId must be a valid positive number" },
      { status: 400 }
    );
  }

  try {
    if (typeof aroundId === "number") {
      const halfLimit = Math.ceil(limit / 2);
      const [olderMessages, newerMessages] = await Promise.all([
        sessionClient.searchRead<OdooMessageRecord[]>(
          "whatsapp.message",
          [
            ["thread_id", "=", threadId],
            ["id", "<=", aroundId],
          ],
          { limit: halfLimit, order: "id DESC", select: MESSAGE_FIELDS }
        ),
        sessionClient.searchRead<OdooMessageRecord[]>(
          "whatsapp.message",
          [
            ["thread_id", "=", threadId],
            ["id", ">", aroundId],
          ],
          { limit: halfLimit, select: MESSAGE_FIELDS }
        ),
      ]);

      const combined = [
        ...(olderMessages ?? []).reverse(),
        ...(newerMessages ?? []),
      ];
      return NextResponse.json({
        threadId,
        messages: combined,
        targetMessageId: aroundId,
      });
    }

    const domain: Array<[string, string, string | number]> = [
      ["thread_id", "=", threadId],
    ];

    if (typeof lastId === "number") {
      if (direction === "backward") {
        domain.push(["id", "<", lastId]);
      } else {
        domain.push(["id", ">", lastId]);
      }
    }

    const messages = await sessionClient.searchRead<OdooMessageRecord[]>(
      "whatsapp.message",
      domain,
      {
        limit,
        order: direction === "backward" ? "id DESC" : undefined,
        select: MESSAGE_FIELDS,
      }
    );

    return NextResponse.json({ threadId, messages });
  } catch (error) {
    return odooErrorResponse(error, "Failed to fetch messages from Odoo");
  }
}

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
  const message =
    typeof payload.message === "string" ? payload.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  const replyToMessageId =
    typeof payload.replyToMessageId === "string"
      ? payload.replyToMessageId
      : null;

  try {
    const recipient = await getThreadRecipient(auth.session, threadId);
    if (!recipient) {
      return threadNotFound();
    }
    const { backendId, phoneNumber } = recipient;
    const result = await (replyToMessageId
      ? auth.session.call(
          "whatsapp.backend",
          "send_reply_message",
          [backendId, phoneNumber, message, replyToMessageId],
          {},
          false
        )
      : auth.session.call(
          "whatsapp.backend",
          "send_text_message",
          [backendId, phoneNumber, message],
          {},
          false
        ));

    return NextResponse.json({ result, threadId });
  } catch (error) {
    return odooErrorResponse(error, "Failed to send message via Odoo");
  }
}
