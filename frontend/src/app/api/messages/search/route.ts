import { NextRequest, NextResponse } from "next/server";
import { odooErrorResponse, requireSession } from "@/app/lib/odoo/server";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
// Odoo walks the matches from the newest to reach the offset
const MAX_OFFSET = 1000;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ("response" in auth) {
    return auth.response;
  }

  const searchQuery = request.nextUrl.searchParams.get("search")?.trim();
  if (!searchQuery) {
    return NextResponse.json({ messages: [] });
  }
  const limit = Number(request.nextUrl.searchParams.get("limit")) || 0;
  const offset = Number(request.nextUrl.searchParams.get("offset")) || 0;

  try {
    const messages = await auth.session.callController(
      "/whatsapp/message/search",
      {
        query: searchQuery,
        limit: clamp(Math.trunc(limit) || DEFAULT_LIMIT, 1, MAX_LIMIT),
        offset: clamp(Math.trunc(offset), 0, MAX_OFFSET),
      }
    );
    return NextResponse.json({ messages });
  } catch (error) {
    return odooErrorResponse(error, "Failed to search messages");
  }
}
