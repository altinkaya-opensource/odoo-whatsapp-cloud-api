import { NextResponse } from "next/server";
import { getOdooBaseUrl, resolveSession } from "@/app/lib/odoo/server";
import { ODOO_TIMEOUT_MS } from "@/app/lib/odoo/jsonrpc";
import { setSessionCookie } from "@/app/lib/session-cookie";

// secrets.token_urlsafe(32) in Odoo
const SSO_CODE = /^[\w-]{20,100}$/;

/** A redirect inside this site: a relative Location ignores the Host header. */
const redirectTo = (path: string) =>
  new NextResponse(null, { status: 303, headers: { Location: path } });

/** Trade Odoo's one-time code for a session of this app's own. */
const exchangeCode = async (code: string): Promise<string | null> => {
  const response = await fetch(
    `${getOdooBaseUrl()}/whatsapp/frontend/sso/exchange`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: { code },
      }),
      signal: AbortSignal.timeout(ODOO_TIMEOUT_MS),
    }
  );
  const data = await response.json();
  const sessionId = data?.result?.session_id;
  return typeof sessionId === "string" ? sessionId : null;
};

/**
 * GET /api/auth/sso-login?code=…&thread_id=…
 *
 * Odoo's "Open WhatsApp" buttons land here with a one-time code. The code is
 * exchanged server to server for a new Odoo session, which goes into the
 * HttpOnly cookie; the browser never sees a session id in a URL.
 *
 * Optional thread_id: the conversation to open after sign-in, when WhatsApp
 * is opened from a partner's form in Odoo.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const threadId = url.searchParams.get("thread_id") ?? "";
  if (!SSO_CODE.test(code)) {
    return redirectTo("/?error=sso_failed");
  }

  try {
    const auth = await resolveSession(await exchangeCode(code));
    if ("response" in auth) {
      return redirectTo("/?error=sso_failed");
    }
    const response = redirectTo(
      /^\d+$/.test(threadId) ? `/?thread_id=${threadId}` : "/"
    );
    setSessionCookie(response, auth.sessionId);
    return response;
  } catch (error) {
    console.error("[SSO] Code exchange failed:", error);
    return redirectTo("/?error=sso_failed");
  }
}
