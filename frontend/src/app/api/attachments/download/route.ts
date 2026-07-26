import { NextRequest, NextResponse } from "next/server";
import { getOdooBaseUrl, isValidSessionId } from "@/app/lib/odoo/server";

// Only this path may be proxied, and only against the configured Odoo host.
const ATTACHMENT_PATH = /^\/whatsapp\/attachment\/download\/\d+$/;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const attachmentUrl = url.searchParams.get("url");
  const sessionId =
    request.headers.get("x-session-id") || url.searchParams.get("session_id");

  if (!attachmentUrl) {
    return NextResponse.json(
      { error: "Missing attachment URL" },
      { status: 400 }
    );
  }

  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: "Missing session ID" }, { status: 401 });
  }

  // Keep only the path of the caller-supplied URL and rebuild it against the
  // configured Odoo origin: the server must never fetch an arbitrary host,
  // which would both be an SSRF vector and leak the session cookie.
  let target: string;
  try {
    const requested = new URL(attachmentUrl, getOdooBaseUrl());
    if (!ATTACHMENT_PATH.test(requested.pathname)) {
      return NextResponse.json(
        { error: "Unsupported attachment URL" },
        { status: 400 }
      );
    }
    target = `${getOdooBaseUrl()}${requested.pathname}`;
  } catch {
    return NextResponse.json(
      { error: "Unsupported attachment URL" },
      { status: 400 }
    );
  }

  try {
    // Fetch the attachment from Odoo backend
    const odooResponse = await fetch(target, {
      method: "GET",
      headers: {
        Cookie: `session_id=${sessionId}`,
      },
    });

    if (!odooResponse.ok) {
      return NextResponse.json(
        { error: `Failed to fetch attachment: ${odooResponse.status}` },
        { status: odooResponse.status }
      );
    }

    // Get the file data
    const fileBuffer = await odooResponse.arrayBuffer();
    const contentType =
      odooResponse.headers.get("Content-Type") || "application/octet-stream";
    const contentDisposition = odooResponse.headers.get("Content-Disposition");

    // Return the file
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": contentDisposition || "attachment",
        // Per-user content: never store it in a shared cache.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to download attachment" },
      { status: 500 }
    );
  }
}
