import { NextRequest, NextResponse } from "next/server";
import {
  getOdooBaseUrl,
  odooErrorResponse,
  requireSession,
} from "@/app/lib/odoo/server";

// Force Node.js runtime for File/Blob support
export const runtime = "nodejs";

// Odoo stores at most 100 MB per file; allow for the multipart envelope
const MAX_UPLOAD_BYTES = 101 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 120_000;

export async function POST(request: NextRequest) {
  // Check the session and the size before reading the body into memory
  const auth = await requireSession(request);
  if ("response" in auth) {
    return auth.response;
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (!contentLength) {
    return NextResponse.json({ error: "File is required" }, { status: 400 });
  }
  if (contentLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 413 });
  }

  try {
    // Parse the multipart form data
    const formData = await request.formData();
    const file = formData.get("file");

    // Check if file exists and is a Blob/File (Node.js compatible check)
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }

    // Type guard for File/Blob - works in both Node.js and Edge runtime
    if (!("name" in file) || !("size" in file) || !("type" in file)) {
      return NextResponse.json(
        { error: "Invalid file format" },
        { status: 400 }
      );
    }

    // TypeScript type assertion after validation
    const uploadFile = file as File;

    // Create form data to forward to Odoo
    const odooFormData = new FormData();
    odooFormData.append("file", uploadFile);
    odooFormData.append("filename", uploadFile.name);

    // Upload to Odoo
    const response = await fetch(
      `${getOdooBaseUrl()}/whatsapp/attachment/upload/`,
      {
        method: "POST",
        headers: {
          Cookie: `session_id=${auth.sessionId}`,
        },
        body: odooFormData,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      }
    );

    if (!response.ok) {
      console.error(
        "[Upload] Odoo refused the file:",
        response.status,
        await response.text().catch(() => "")
      );
      return NextResponse.json(
        {
          error:
            response.status === 413
              ? "File too large"
              : "Failed to upload attachment to Odoo",
        },
        { status: response.status }
      );
    }

    // Parse the response from Odoo (should return attachment ID)
    const data = await response.json();

    return NextResponse.json({
      attachmentId: data.id || data.attachment_id || data,
      fileName: uploadFile.name,
      fileSize: uploadFile.size,
      mimeType: uploadFile.type,
    });
  } catch (error) {
    return odooErrorResponse(error, "Failed to upload attachment");
  }
}
