import { NextRequest, NextResponse } from "next/server";
import {
  getOdooBaseUrl,
  requireSession,
  UNTRUSTED_FILE_HEADERS,
} from "@/app/lib/odoo/server";
import { ODOO_TIMEOUT_MS } from "@/app/lib/odoo/jsonrpc";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ partnerId: string }> }
) {
  const { partnerId } = await params;
  if (!/^\d+$/.test(partnerId)) {
    return new NextResponse(null, { status: 404 });
  }

  const auth = await requireSession(request);
  if ("response" in auth) {
    return new NextResponse(null, { status: auth.response.status });
  }

  try {
    const response = await fetch(
      `${getOdooBaseUrl()}/whatsapp/partner/profile_picture/${partnerId}`,
      {
        headers: {
          Cookie: `session_id=${auth.sessionId}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(ODOO_TIMEOUT_MS),
      }
    );

    // A missing picture, or a login page instead of one: the Profile
    // component then shows the coloured initials
    const contentType = response.headers.get("Content-Type") || "";
    if (!response.ok || !contentType.startsWith("image/")) {
      return new NextResponse(null, { status: 404 });
    }

    return new NextResponse(await response.arrayBuffer(), {
      status: 200,
      headers: {
        ...UNTRUSTED_FILE_HEADERS,
        // Odoo serves avatars as PNG; never pass another type through
        "Content-Type": "image/png",
        // Per-user content: never store it in a shared cache
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
