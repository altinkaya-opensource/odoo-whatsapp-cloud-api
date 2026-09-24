import { NextResponse } from "next/server";
import { createOdooClient, isValidSessionId } from "@/app/lib/odoo/server";
import { closeBusConnection } from "@/app/lib/realtime/odoo-bus";
import { sessionCache } from "@/app/lib/session-cache";
import { clearSessionCookie, readSessionId } from "@/app/lib/session-cookie";

/**
 * Sign out: end the Odoo session itself, not only this browser's copy, so a
 * session id that leaked earlier stops working too.
 */
export async function POST(request: Request) {
  const sessionId = readSessionId(request);
  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  if (!sessionId || !isValidSessionId(sessionId)) {
    return response;
  }

  sessionCache.delete(sessionId);
  closeBusConnection(sessionId);
  try {
    await createOdooClient()
      .createSession(sessionId)
      .callController("/web/session/destroy", {});
  } catch (error) {
    // Already expired, or Odoo is down: the cookie is gone either way
    console.warn("[Logout] Odoo did not destroy the session:", error);
  }
  return response;
}
