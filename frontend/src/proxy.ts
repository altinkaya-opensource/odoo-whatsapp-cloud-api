import { NextRequest, NextResponse } from "next/server";

const isDev = process.env.NODE_ENV === "development";

// Requests that only read; any other method changes something
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Only this origin's own scripts run: every script needs the per-request
 * nonce that Next adds to its own. Style attributes cannot carry a nonce,
 * so styles stay open. Images may come from Odoo (agents' avatars).
 */
const contentSecurityPolicy = (nonce: string) =>
  [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: https:${isDev ? " http:" : ""}`,
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

/** A browser request sent by a page of another site. */
const isCrossSite = (request: NextRequest) => {
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }
  try {
    return new URL(origin).host !== request.headers.get("host");
  } catch {
    return true;
  }
};

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    // The SameSite cookie already stays home; refuse the request as well
    if (!SAFE_METHODS.has(request.method) && isCrossSite(request)) {
      return NextResponse.json(
        { error: "Cross-site request refused" },
        { status: 403 }
      );
    }
    return NextResponse.next();
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce);
  // Next reads the nonce from the request's policy and puts it on its scripts
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:mp3|svg|png|ico)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
