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

export type SimpleTemplate = {
  id: number;
  name: string;
  language: string;
  category: string;
  header_text: string;
  body_text: string;
  footer_text: string;
  preview: string;
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

  const backendIdParam = request.nextUrl.searchParams.get("backendId");
  const resolvedBackendId = backendIdParam
    ? Number(backendIdParam)
    : process.env.ODOO_WHATSAPP_BACKEND_ID
      ? Number(process.env.ODOO_WHATSAPP_BACKEND_ID)
      : undefined;

  if (
    typeof resolvedBackendId !== "number" ||
    Number.isNaN(resolvedBackendId) ||
    resolvedBackendId <= 0
  ) {
    return NextResponse.json(
      { error: "A valid backend id is required to list templates" },
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
    const templates = await sessionClient.call<SimpleTemplate[]>(
      "whatsapp.backend",
      "get_simple_templates",
      [resolvedBackendId],
      {},
      false
    );

    return NextResponse.json({ templates: templates ?? [] });
  } catch (error) {
    const err = error as Error;
    return NextResponse.json(
      { error: err.message || "Failed to fetch templates from Odoo" },
      { status: 500 }
    );
  }
}
