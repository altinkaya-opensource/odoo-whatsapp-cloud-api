import { NextResponse } from "next/server";
import { isValidSessionId } from "@/app/lib/odoo/server";

/**
 * SSO Login Endpoint
 *
 * This endpoint handles Single Sign-On (SSO) authentication from Odoo.
 * It accepts an Odoo session ID and redirects to the main page where
 * the React app will automatically authenticate the user.
 *
 * Flow:
 * 1. User clicks "Open WhatsApp" button in Odoo
 * 2. Odoo backend generates SSO URL with session ID
 * 3. This endpoint redirects to main page with session parameter
 * 4. React app detects parameter and calls loginWithSessionId()
 * 5. Session stored in localStorage via existing auth flow
 *
 * Optional thread_id parameter:
 * - If provided, the frontend will auto-select this conversation after login
 * - Used when opening WhatsApp from a partner's form view in Odoo
 *
 * Security:
 * - Session ID passed via HTTPS (encrypted in transit)
 * - Session validated client-side via existing validation endpoint
 * - URL parameter cleaned immediately (no browser history)
 * - Uses existing authentication flow
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session");
  const threadId = url.searchParams.get("thread_id");

  // Get the actual host from headers (for reverse proxy support)
  // Priority: x-forwarded-host > host header > url.origin
  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    url.host;

  // Get protocol from headers (for reverse proxy support)
  const protocol =
    request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");

  // Construct the base URL using the actual host that the user sees
  const baseUrl = `${protocol}://${host}`;

  // Validate the session parameter looks like an Odoo session id before
  // handing it to the app, so arbitrary values cannot be planted in the URL.
  if (!isValidSessionId(sessionId?.trim())) {
    // Redirect to root with error parameter
    return NextResponse.redirect(new URL("/?error=missing_session", baseUrl));
  }

  // Build redirect URL with SSO session and optional thread_id
  let redirectPath = `/?sso_session=${encodeURIComponent((sessionId as string).trim())}`;
  if (threadId && threadId.trim().length > 0) {
    redirectPath += `&thread_id=${encodeURIComponent(threadId.trim())}`;
  }

  // Redirect to main page with SSO session parameter
  // The React app will detect this and automatically log in
  // Use baseUrl to ensure we redirect to the public-facing domain (not localhost)
  return NextResponse.redirect(new URL(redirectPath, baseUrl));
}
