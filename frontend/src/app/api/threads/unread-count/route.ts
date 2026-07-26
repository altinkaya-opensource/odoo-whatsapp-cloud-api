import { NextRequest, NextResponse } from "next/server";
import { createOdooClient } from "@/app/lib/odoo/server";

/**
 * Unread total for the signed-in user across every thread, including the
 * ones the client has not loaded yet.
 */
export async function GET(request: NextRequest) {
  const sessionId = request.headers.get("x-session-id");

  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing Odoo session id" },
      { status: 401 }
    );
  }

  try {
    const session = createOdooClient().createSession(sessionId);
    const result = await session.callController<{ unread_count?: number }>(
      "/whatsapp/unread_count",
      {}
    );

    return NextResponse.json({ unreadCount: result?.unread_count ?? 0 });
  } catch (error) {
    const err = error as Error;
    return NextResponse.json(
      { error: err.message || "Failed to fetch unread count" },
      { status: 500 }
    );
  }
}
