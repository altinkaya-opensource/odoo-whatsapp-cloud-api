import { NextResponse } from "next/server";
import { OdooClient } from "./jsonrpc";
import { sessionCache } from "../session-cache";

/**
 * Server-side Odoo helpers shared by the API routes.
 */

const protocol = (): "http" | "https" =>
  process.env.ODOO_JSONRPC_PROTOCOL === "https" ? "https" : "http";

/** Origin of the Odoo instance, built only from server configuration. */
export const getOdooBaseUrl = (): string => {
  const host = process.env.ODOO_JSONRPC_HOST;
  if (!host) {
    throw new Error("ODOO_JSONRPC_HOST is not configured");
  }

  const scheme = protocol();
  const port = process.env.ODOO_JSONRPC_PORT;
  const isDefaultPort =
    !port ||
    (scheme === "http" && port === "80") ||
    (scheme === "https" && port === "443");

  return `${scheme}://${host}${isDefaultPort ? "" : `:${port}`}`;
};

export const createOdooClient = (): OdooClient => {
  const port = process.env.ODOO_JSONRPC_PORT
    ? Number(process.env.ODOO_JSONRPC_PORT)
    : undefined;

  if (typeof port !== "undefined" && Number.isNaN(port)) {
    throw new Error("ODOO_JSONRPC_PORT must be a valid number");
  }

  return new OdooClient({
    host: process.env.ODOO_JSONRPC_HOST as string,
    port,
    protocol: protocol(),
  });
};

/** Odoo session ids are 40 hex characters. */
export const isValidSessionId = (value: string | null | undefined): boolean =>
  typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);

/**
 * Resolve the caller's Odoo session, or return the 401 response to send back.
 *
 * Sessions that authenticated through this app are in the in-memory cache;
 * anything else is checked once against Odoo and then cached, so a restart or
 * an SSO hand-off does not lock a valid user out.
 */
export const requireSession = async (
  request: Request
): Promise<{ sessionId: string } | { response: NextResponse }> => {
  const sessionId = request.headers.get("x-session-id");

  if (!isValidSessionId(sessionId)) {
    return {
      response: NextResponse.json(
        { error: "Missing Odoo session id" },
        { status: 401 }
      ),
    };
  }

  const validSessionId = sessionId as string;
  if (sessionCache.has(validSessionId)) {
    return { sessionId: validSessionId };
  }

  try {
    const session = createOdooClient().createSession(validSessionId);
    const info = await session.call<{ uid?: number }>(
      "ir.http",
      "session_info",
      [[]],
      {},
      false
    );
    if (typeof info?.uid === "number" && info.uid > 0) {
      return { sessionId: validSessionId };
    }
  } catch (error) {
    console.error("[Auth] Session validation failed:", error);
  }

  return {
    response: NextResponse.json(
      { error: "Invalid or expired session" },
      { status: 401 }
    ),
  };
};
