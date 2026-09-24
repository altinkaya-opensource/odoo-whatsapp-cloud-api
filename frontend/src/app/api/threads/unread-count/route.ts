import { NextRequest, NextResponse } from "next/server";
import { odooErrorResponse, requireSession } from "@/app/lib/odoo/server";

/**
 * Unread total for the signed-in user across every thread, including the
 * ones the client has not loaded yet.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ("response" in auth) {
    return auth.response;
  }

  try {
    const result = await auth.session.callController<{ unread_count?: number }>(
      "/whatsapp/unread_count",
      {}
    );

    return NextResponse.json({ unreadCount: result?.unread_count ?? 0 });
  } catch (error) {
    return odooErrorResponse(error, "Failed to fetch unread count");
  }
}
