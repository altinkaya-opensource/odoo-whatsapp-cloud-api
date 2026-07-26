import { NextRequest, NextResponse } from "next/server";
import { OdooClient } from "@/app/lib/odoo/jsonrpc";

const REQUIRED_ENV_VARS = [
  "ODOO_JSONRPC_HOST",
  "ODOO_JSONRPC_DATABASE",
] as const;

const ensureEnv = () => {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
};

const THREAD_FIELDS = [
  "name",
  "last_message_date",
  "last_message_preview",
  "phone_number",
  "backend_id",
  "write_date",
  "unread_count",
  "partner_id",
  "has_avatar",
];

type ThreadRecord = {
  id: number;
  name: string;
  last_message_date: string | null;
  last_message_preview: string | null;
  phone_number: string | null;
  backend_id: number | [number, string] | null;
  write_date: string;
  unread_count: number;
  partner_id: number | [number, string] | null;
  has_avatar: boolean;
};

export async function GET(request: NextRequest) {
  try {
    ensureEnv();
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Server configuration error",
      },
      { status: 500 }
    );
  }

  const sessionId = request.headers.get("x-session-id");

  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing Odoo session id" },
      { status: 401 }
    );
  }

  // Optional: include a specific thread ID (for deep linking from Odoo)
  const includeThreadIdParam =
    request.nextUrl.searchParams.get("includeThreadId");
  const includeThreadId = includeThreadIdParam
    ? parseInt(includeThreadIdParam, 10)
    : null;
  const limitParam = request.nextUrl.searchParams.get("limit");
  const offsetParam = request.nextUrl.searchParams.get("offset");
  const searchQuery = request.nextUrl.searchParams.get("search");
  const backendIdParam = request.nextUrl.searchParams.get("backendId");
  const limit = limitParam ? Number(limitParam) : 30;
  const offset = offsetParam ? Number(offsetParam) : 0;
  const backendId = backendIdParam ? Number(backendIdParam) : null;

  if (backendId !== null && !Number.isSafeInteger(backendId)) {
    return NextResponse.json(
      { error: "backendId must be a valid integer" },
      { status: 400 }
    );
  }

  if (!Number.isFinite(limit) || limit <= 0) {
    return NextResponse.json(
      { error: "limit must be a valid positive number" },
      { status: 400 }
    );
  }

  if (!Number.isFinite(offset) || offset < 0) {
    return NextResponse.json(
      { error: "offset must be a valid non-negative number" },
      { status: 400 }
    );
  }

  const protocolEnv: "http" | "https" =
    process.env.ODOO_JSONRPC_PROTOCOL === "https" ? "https" : "http";
  const portEnv = process.env.ODOO_JSONRPC_PORT;
  const port = portEnv ? Number(portEnv) : undefined;

  if (typeof port !== "undefined" && Number.isNaN(port)) {
    return NextResponse.json(
      { error: "ODOO_JSONRPC_PORT must be a valid number" },
      { status: 500 }
    );
  }

  const odooClient = new OdooClient({
    host: process.env.ODOO_JSONRPC_HOST as string,
    port,
    protocol: protocolEnv,
  });

  const sessionClient = odooClient.createSession(sessionId);

  try {
    // Build search domain
    // Using Odoo's Polish notation for OR: "|" operator before the conditions
    type DomainElement = [string, string, unknown] | string;
    const domain: DomainElement[] = [];

    // Filter by phone number server-side. Doing it in the browser meant
    // paging through every backend's threads to find one backend's.
    if (backendId !== null) {
      domain.push(["backend_id", "=", backendId]);
    }

    if (searchQuery && searchQuery.trim().length > 0) {
      const query = searchQuery.trim();
      // OR condition: search in thread name OR partner name
      domain.push("|");
      domain.push(["name", "ilike", query]);
      domain.push(["partner_id.display_name", "ilike", query]);
    }

    // Fetch recent threads. Order by the indexed last_message_date, which is
    // also how the client sorts the list - ordering by the unindexed
    // write_date made every page a full sort and broke pagination.
    const threads = await sessionClient.searchRead<ThreadRecord[]>(
      "whatsapp.thread",
      domain,
      {
        limit: Math.min(limit, 100),
        offset,
        select: THREAD_FIELDS,
        order: "last_message_date desc, id desc",
      }
    );

    // If a specific thread ID is requested and not in the results, fetch it separately
    if (
      offset === 0 &&
      includeThreadId &&
      !isNaN(includeThreadId) &&
      !threads.some((t) => t.id === includeThreadId)
    ) {
      const specificThread = await sessionClient.searchRead<ThreadRecord[]>(
        "whatsapp.thread",
        [["id", "=", includeThreadId]],
        {
          limit: 1,
          select: THREAD_FIELDS,
        }
      );

      if (specificThread && specificThread.length > 0) {
        // Add the specific thread at the beginning of the list
        threads.unshift(specificThread[0]);
      }
    }

    return NextResponse.json({ threads });
  } catch (error) {
    const err = error as Error;
    return NextResponse.json(
      { error: err.message || "Failed to fetch threads from Odoo" },
      { status: 500 }
    );
  }
}
