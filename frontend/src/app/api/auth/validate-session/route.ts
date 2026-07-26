import { NextResponse } from "next/server";
import { OdooClient } from "@/app/lib/odoo/jsonrpc";
import { sessionCache } from "@/app/lib/session-cache";

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

export async function POST(request: Request) {
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

  const { sessionId } = await request.json();

  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return NextResponse.json(
      { error: "Session ID is required" },
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

  try {
    // Create a session client with the provided session ID (initially without context)
    const tempSession = odooClient.createSession(sessionId.trim());

    // Validate the session by calling ir.http's session_info method
    const sessionInfo = await tempSession.call<{
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
      return NextResponse.json(
        { error: "Invalid or expired session ID" },
        { status: 401 }
      );
    }

    // Create a new session with the proper user_context from session_info
    const session = odooClient.createSession(
      sessionId.trim(),
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
        sessionCache.set(sessionId.trim(), backend.backend_ids);
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
    const err = error as Error & {
      code?: number;
      data?: { name?: string; message?: string };
    };

    const status =
      err.data?.name === "odoo.exceptions.AccessDenied" ? 401 : 500;
    const message =
      err.message || err.data?.message || "Unable to validate session ID";

    return NextResponse.json({ error: message }, { status });
  }
}
