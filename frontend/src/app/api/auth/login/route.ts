import { NextResponse } from "next/server";
import { OdooClient } from "@/app/lib/odoo/jsonrpc";
import { sessionCache } from "@/app/lib/session-cache";
import {
  clearPendingTotpCookie,
  setPendingTotpCookie,
} from "@/app/lib/pending-totp";

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

  const { username, password } = await request.json();

  if (typeof username !== "string" || typeof password !== "string") {
    return NextResponse.json(
      { error: "Username and password are required" },
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
    const { sessionId, result, session } = await odooClient.authenticate({
      database: process.env.ODOO_JSONRPC_DATABASE as string,
      username,
      password,
    });

    // Odoo deliberately returns uid: null after a correct password when
    // TOTP is enabled. Keep that partial session server-side until the code
    // is verified; it is not an authenticated WhatsApp session yet.
    if (result.uid === null) {
      const response = NextResponse.json({ totpRequired: true });
      setPendingTotpCookie(response, sessionId);
      return response;
    }

    if (typeof result.uid !== "number" || result.uid <= 0) {
      return NextResponse.json(
        { error: "Unable to complete sign-in with Odoo" },
        { status: 500 }
      );
    }

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
        sessionCache.set(sessionId, backend.backend_ids);
      } else {
        console.warn(
          `[Login] No backend_ids returned from initialize_web for session ${sessionId}`
        );
      }
    } catch (error) {
      console.error("[Login] Failed to initialize WhatsApp backend:", error);
      // Failed to initialize WhatsApp backend - not critical for login
    }

    const response = NextResponse.json({
      sessionId,
      user: result,
      backend,
    });
    clearPendingTotpCookie(response);
    return response;
  } catch (error) {
    const err = error as Error & {
      code?: number;
      data?: { name?: string; message?: string };
    };

    const status =
      err.data?.name === "odoo.exceptions.AccessDenied" ? 401 : 500;
    const message =
      err.message || err.data?.message || "Unable to authenticate with Odoo";

    return NextResponse.json({ error: message }, { status });
  }
}
