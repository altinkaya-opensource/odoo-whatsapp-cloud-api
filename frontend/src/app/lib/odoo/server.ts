import { NextResponse } from "next/server";
import { OdooClient, type OdooSessionClient } from "./jsonrpc";
import { sessionCache } from "../session-cache";

/**
 * Server-side Odoo helpers shared by the API routes.
 */

type OdooError = Error & {
  code?: number;
  data?: { name?: string; message?: string };
};

export type SessionAuth = {
  sessionId: string;
  session: OdooSessionClient;
  /** WhatsApp backends the user is a member of */
  backendIds: number[];
};

type AuthResult = SessionAuth | { response: NextResponse };

// Odoo errors whose message is written for the user, by HTTP status
const USER_ERROR_STATUS: Record<string, number> = {
  "odoo.exceptions.UserError": 400,
  "odoo.exceptions.ValidationError": 400,
  "odoo.exceptions.AccessError": 403,
  "odoo.exceptions.MissingError": 404,
};

/**
 * Headers for files proxied from Odoo. Customers send them: an HTML or SVG
 * file opened from this origin must not run scripts next to the session.
 */
export const UNTRUSTED_FILE_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; img-src 'self' data:",
  "X-Content-Type-Options": "nosniff",
};

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

/** Odoo refused the session: expired, signed out or never authenticated. */
export const isSessionRejected = (error: unknown): boolean => {
  const err = error as OdooError | null;
  return (
    err?.code === 100 ||
    err?.data?.name === "odoo.exceptions.AccessDenied" ||
    err?.data?.name === "odoo.http.SessionExpiredException"
  );
};

const unauthorized = () =>
  NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });

/**
 * The response for a failed Odoo call.
 *
 * 401 when Odoo no longer accepts the session, Odoo's own message for
 * errors written for the user, 504 on a timeout, and `fallback` for
 * anything else, which is logged instead of sent to the browser.
 */
export const odooErrorResponse = (
  error: unknown,
  fallback: string
): NextResponse => {
  if (isSessionRejected(error)) {
    return unauthorized();
  }
  const err = error as OdooError | null;
  const userErrorStatus = USER_ERROR_STATUS[err?.data?.name ?? ""];
  if (userErrorStatus) {
    return NextResponse.json(
      { error: err?.data?.message || fallback },
      { status: userErrorStatus }
    );
  }
  console.error(`[Odoo] ${fallback}:`, error);
  const status = err?.name === "TimeoutError" ? 504 : 500;
  return NextResponse.json({ error: fallback }, { status });
};

/**
 * The WhatsApp backends of the session's user.
 *
 * Asking Odoo also proves the session is alive. The answer is cached for a
 * few minutes, so a revoked session or a removed member loses access soon
 * after, without a call on every request.
 */
const loadBackendIds = async (sessionId: string): Promise<number[]> => {
  const cached = sessionCache.get(sessionId);
  if (cached) {
    return cached;
  }
  const result = await createOdooClient().createSession(sessionId).call<{
    backend_ids?: number[];
  }>("whatsapp.backend", "initialize_web", [[]], {}, false);
  const backendIds = Array.isArray(result?.backend_ids)
    ? result.backend_ids
    : [];
  sessionCache.set(sessionId, backendIds);
  return backendIds;
};

/** Check a session id with Odoo and build a client for it. */
export const resolveSession = async (
  sessionId: string | null
): Promise<AuthResult> => {
  if (!sessionId || !isValidSessionId(sessionId)) {
    return { response: unauthorized() };
  }
  try {
    const backendIds = await loadBackendIds(sessionId);
    const session = createOdooClient().createSession(sessionId);
    return { sessionId, session, backendIds };
  } catch (error) {
    return {
      response: odooErrorResponse(error, "Unable to check the session"),
    };
  }
};

/** Resolve the caller's Odoo session, or return the response to send. */
export const requireSession = (request: Request): Promise<AuthResult> =>
  resolveSession(request.headers.get("x-session-id"));

/**
 * Parse a positive integer id from a request, or return null.
 */
export const parseId = (value: unknown): number | null => {
  const id = typeof value === "string" ? Number(value) : value;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0
    ? id
    : null;
};

type ThreadRecipient = { phoneNumber: string; backendId: number };

/**
 * Who a message on this thread goes to, read with the user's rights.
 *
 * The send routes take only the thread id, so a user can reach only the
 * customers of threads Odoo lets them read. Returns null when the thread
 * does not exist or is not theirs.
 */
export const getThreadRecipient = async (
  session: OdooSessionClient,
  threadId: number
): Promise<ThreadRecipient | null> => {
  const [thread] = await session.searchRead<
    {
      phone_number: string | false;
      backend_id: [number, string] | false;
    }[]
  >("whatsapp.thread", [["id", "=", threadId]], {
    limit: 1,
    select: ["phone_number", "backend_id"],
  });
  if (!thread?.phone_number || !thread.backend_id) {
    return null;
  }
  return { phoneNumber: thread.phone_number, backendId: thread.backend_id[0] };
};

export const threadNotFound = () =>
  NextResponse.json({ error: "Thread not found" }, { status: 404 });

/** Read a JSON object body, or return null when it is not one. */
export const readJsonBody = async (
  request: Request
): Promise<Record<string, unknown> | null> => {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

export const invalidBody = () =>
  NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
