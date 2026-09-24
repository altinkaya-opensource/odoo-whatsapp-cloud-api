import type { NextResponse } from "next/server";

/**
 * The Odoo session lives in an HttpOnly cookie that only this server reads.
 *
 * Scripts in the page never see it, and it never travels in a URL, so it
 * does not end up in history, logs or Referer headers. SameSite=Strict keeps
 * other sites from sending it.
 */
export const SESSION_COOKIE = "whatsapp_session";

// Odoo keeps an idle session for a week
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const cookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export const setSessionCookie = (response: NextResponse, sessionId: string) => {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: sessionId,
    maxAge: SESSION_MAX_AGE_SECONDS,
    ...cookieOptions,
  });
};

export const clearSessionCookie = (response: NextResponse) => {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    maxAge: 0,
    ...cookieOptions,
  });
};

/** The session id from the request's cookie, or null. */
export const readSessionId = (request: Request): string | null => {
  const cookies = request.headers.get("cookie") ?? "";
  const match = cookies.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`)
  );
  return match ? decodeURIComponent(match[1]) : null;
};
