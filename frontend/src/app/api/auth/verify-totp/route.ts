import { NextResponse, type NextRequest } from "next/server";
import { OdooClient } from "@/app/lib/odoo/jsonrpc";
import {
  clearPendingTotpCookie,
  isValidOdooSessionId,
  PENDING_TOTP_COOKIE,
} from "@/app/lib/pending-totp";
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

type WhatsAppBackend = {
  backend_id?: number;
  backend_ids?: number[];
  user_id?: number;
  language?: string;
  company_id?: number;
  users?: Array<{ id: number; name: string; image_url?: string }>;
};

const makeOdooClient = () => {
  const protocol: "http" | "https" =
    process.env.ODOO_JSONRPC_PROTOCOL === "https" ? "https" : "http";
  const portEnv = process.env.ODOO_JSONRPC_PORT;
  const port = portEnv ? Number(portEnv) : undefined;

  if (typeof port !== "undefined" && Number.isNaN(port)) {
    throw new Error("ODOO_JSONRPC_PORT must be a valid number");
  }

  return new OdooClient({
    host: process.env.ODOO_JSONRPC_HOST as string,
    port,
    protocol,
  });
};

const clearPendingAndRespond = (
  body: Record<string, unknown>,
  status: number
) => {
  const response = NextResponse.json(body, { status });
  clearPendingTotpCookie(response);
  return response;
};

export async function POST(request: NextRequest) {
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

  const pendingSessionId = request.cookies.get(PENDING_TOTP_COOKIE)?.value;
  if (!isValidOdooSessionId(pendingSessionId)) {
    return clearPendingAndRespond({ error: "totp_expired" }, 401);
  }

  let code: unknown;
  try {
    ({ code } = await request.json());
  } catch {
    return NextResponse.json({ error: "totp_invalid_format" }, { status: 400 });
  }
  const normalizedCode =
    typeof code === "string" ? code.replace(/\s/g, "") : "";
  if (!/^\d{6}$/.test(normalizedCode)) {
    return NextResponse.json({ error: "totp_invalid_format" }, { status: 400 });
  }

  let odooClient: OdooClient;
  try {
    odooClient = makeOdooClient();
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Server configuration error",
      },
      { status: 500 }
    );
  }

  try {
    const { sessionId, result, session } = await odooClient.verifyTotp(
      pendingSessionId,
      normalizedCode
    );

    if (typeof result.uid !== "number" || result.uid <= 0) {
      return clearPendingAndRespond({ error: "totp_expired" }, 401);
    }

    let backend: WhatsAppBackend | null = null;
    try {
      backend = await session.call<WhatsAppBackend>(
        "whatsapp.backend",
        "initialize_web",
        [[]],
        {},
        false
      );

      if (Array.isArray(backend.backend_ids)) {
        sessionCache.set(sessionId, backend.backend_ids);
      } else {
        console.warn(
          "[VerifyTotp] No backend_ids returned from initialize_web"
        );
      }
    } catch (error) {
      console.error(
        "[VerifyTotp] Failed to initialize WhatsApp backend:",
        error
      );
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
    if (
      err.code === 100 ||
      err.message === "Odoo Session Expired" ||
      err.message ===
        "Unable to determine finalized Odoo session id from response" ||
      err.data?.message === "No pending two-factor authentication."
    ) {
      return clearPendingAndRespond({ error: "totp_expired" }, 401);
    }

    if (err.data?.name === "odoo.exceptions.AccessDenied") {
      return NextResponse.json({ error: "totp_invalid" }, { status: 401 });
    }

    console.error("[VerifyTotp] TOTP verification failed:", error);
    return NextResponse.json({ error: "totp_unavailable" }, { status: 503 });
  }
}
