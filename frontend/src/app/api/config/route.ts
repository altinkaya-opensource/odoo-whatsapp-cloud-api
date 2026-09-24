import { NextRequest, NextResponse } from "next/server";
import { getOdooBaseUrl, requireSession } from "@/app/lib/odoo/server";

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ("response" in auth) {
    return auth.response;
  }

  return NextResponse.json({
    // Where users open Odoo, when JSON-RPC goes through an internal address
    odooBaseUrl: process.env.ODOO_PUBLIC_URL || getOdooBaseUrl(),
    // Reply suggestions need the RAG service; without it the UI hides them
    suggestionsEnabled: Boolean(process.env.RAG_SUPPORTED_CHAT_URL),
  });
}
