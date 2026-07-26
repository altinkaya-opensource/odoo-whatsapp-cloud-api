import type { NextResponse } from "next/server";

export const PENDING_TOTP_COOKIE = "whatsapp_pending_totp";
export const PENDING_TOTP_COOKIE_PATH = "/api/auth/verify-totp";
const PENDING_TOTP_MAX_AGE_SECONDS = 5 * 60;

const pendingTotpCookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  path: PENDING_TOTP_COOKIE_PATH,
};

export const setPendingTotpCookie = (
  response: NextResponse,
  sessionId: string
) => {
  response.cookies.set({
    name: PENDING_TOTP_COOKIE,
    value: sessionId,
    maxAge: PENDING_TOTP_MAX_AGE_SECONDS,
    ...pendingTotpCookieOptions,
  });
};

export const clearPendingTotpCookie = (response: NextResponse) => {
  response.cookies.set({
    name: PENDING_TOTP_COOKIE,
    value: "",
    maxAge: 0,
    ...pendingTotpCookieOptions,
  });
};

export const isValidOdooSessionId = (
  sessionId: string | undefined
): sessionId is string =>
  typeof sessionId === "string" && /^[a-f0-9]{40}$/i.test(sessionId);
