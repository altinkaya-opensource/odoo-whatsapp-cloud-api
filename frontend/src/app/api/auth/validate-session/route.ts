import { NextResponse } from "next/server";
import {
  createOdooClient,
  isSessionRejected,
  isValidSessionId,
} from "@/app/lib/odoo/server";
import { sessionCache } from "@/app/lib/session-cache";
import { clearSessionCookie, readSessionId } from "@/app/lib/session-cookie";

const unauthorized = (message: string) => {
  const response = NextResponse.json({ error: message }, { status: 401 });
  clearSessionCookie(response);
  return response;
};

/**
 * Who the session cookie belongs to, with their WhatsApp backends.
 *
 * 401 (and the cookie cleared) only when Odoo rejects the session; when Odoo
 * cannot be reached the user stays signed in and retries.
 */
export async function POST(request: Request) {
  const sessionId = readSessionId(request);
  if (!sessionId || !isValidSessionId(sessionId)) {
    return unauthorized("Not signed in");
  }

  try {
    const odooClient = createOdooClient();

    // Validate the session by calling ir.http's session_info method
    const sessionInfo = await odooClient.createSession(sessionId).call<{
      uid?: number;
      username?: string;
      name?: string;
      partner_display_name?: string;
      user_context?: Record<string, unknown>;
      db?: string;
      server_version?: string;
      company_id?: number;
      partner_id?: number;
      [key: string]: unknown;
    }>("ir.http", "session_info", [[]], {}, false);

    if (!sessionInfo || !sessionInfo.uid) {
      return unauthorized("Invalid or expired session");
    }

    // Create a new session with the proper user_context from session_info
    const session = odooClient.createSession(
      sessionId,
      sessionInfo.user_context || {}
    );

    // Try to initialize WhatsApp backend with the proper context
    let backend = null;
    try {
      backend = await session.call<{
        backend_id?: number;
        backend_ids?: number[];
        user_id?: number;
        language?: string;
        company_id?: number;
        users?: Array<{ id: number; name: string; image_url?: string }>;
      }>("whatsapp.backend", "initialize_web", [[]], {}, false);

      // Store backend_ids in server-side cache for secure SSE access control
      if (backend && Array.isArray(backend.backend_ids)) {
        sessionCache.set(sessionId, backend.backend_ids);
      } else {
        console.warn(
          "[ValidateSession] No backend_ids returned from initialize_web"
        );
      }
    } catch (error) {
      console.error(
        "[ValidateSession] Failed to initialize WhatsApp backend:",
        error
      );
      // Failed to initialize WhatsApp backend - not critical
    }

    return NextResponse.json({
      user: sessionInfo,
      backend,
    });
  } catch (error) {
    if (isSessionRejected(error)) {
      return unauthorized("Invalid or expired session");
    }
    console.error("[ValidateSession] Unable to validate the session:", error);
    return NextResponse.json(
      { error: "Unable to validate the session" },
      { status: 500 }
    );
  }
}
