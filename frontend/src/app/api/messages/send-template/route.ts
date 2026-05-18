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

  const sessionId = request.headers.get("x-session-id");
  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing Odoo session id" },
      { status: 401 }
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { threadId, phoneNumber, templateId, backendId } = payload as {
    threadId?: number | string;
    phoneNumber?: string;
    templateId?: number;
    backendId?: number;
  };

  const parsedThreadId =
    typeof threadId === "string" ? Number(threadId) : threadId;
  if (typeof parsedThreadId !== "number" || Number.isNaN(parsedThreadId)) {
    return NextResponse.json(
      { error: "threadId must be a valid number" },
      { status: 400 }
    );
  }

  if (!phoneNumber || typeof phoneNumber !== "string") {
    return NextResponse.json(
      { error: "phoneNumber is required" },
      { status: 400 }
    );
  }

  if (typeof templateId !== "number" || templateId <= 0) {
    return NextResponse.json(
      { error: "templateId must be a positive number" },
      { status: 400 }
    );
  }

  const resolvedBackendId =
    typeof backendId === "number"
      ? backendId
      : process.env.ODOO_WHATSAPP_BACKEND_ID
        ? Number(process.env.ODOO_WHATSAPP_BACKEND_ID)
        : undefined;

  if (
    typeof resolvedBackendId !== "number" ||
    Number.isNaN(resolvedBackendId) ||
    resolvedBackendId <= 0
  ) {
    return NextResponse.json(
      { error: "A valid backend id is required to send templates" },
      { status: 500 }
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
    const result = await sessionClient.call(
      "whatsapp.backend",
      "send_simple_template",
      [resolvedBackendId, phoneNumber, templateId],
      {},
      false
    );

    return NextResponse.json({
      result,
      threadId: parsedThreadId,
    });
  } catch (error) {
    const err = error as Error;
    return NextResponse.json(
      { error: err.message || "Failed to send template via Odoo" },
      { status: 500 }
    );
  }
}
