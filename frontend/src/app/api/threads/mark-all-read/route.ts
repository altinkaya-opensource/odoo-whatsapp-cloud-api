import { NextRequest, NextResponse } from "next/server";
import { odooErrorResponse, requireSession } from "@/app/lib/odoo/server";

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ("response" in auth) {
    return auth.response;
  }

  try {
    const result = await auth.session.callController(
      "/whatsapp/mark_all_read",
      {}
    );
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return odooErrorResponse(error, "Failed to mark all threads as read");
  }
}
