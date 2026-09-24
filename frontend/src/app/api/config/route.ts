import { NextResponse } from "next/server";

export async function GET() {
  const protocol = process.env.ODOO_JSONRPC_PROTOCOL || "http";
  const host = process.env.ODOO_JSONRPC_HOST;
  const port = process.env.ODOO_JSONRPC_PORT;

  if (!host) {
    return NextResponse.json(
      { error: "ODOO_JSONRPC_HOST not configured" },
      { status: 500 }
    );
  }

  // Build base URL
  let baseUrl = `${protocol}://${host}`;
  if (port && port !== "80" && port !== "443") {
    baseUrl += `:${port}`;
  }

  return NextResponse.json({
    odooBaseUrl: baseUrl,
    // Reply suggestions need the RAG service; without it the UI hides them
    suggestionsEnabled: Boolean(process.env.RAG_SUPPORTED_CHAT_URL),
  });
}
