import { NextResponse } from "next/server";
import {
  createOdooClient,
  invalidBody,
  readJsonBody,
} from "@/app/lib/odoo/server";
import { sessionCache } from "@/app/lib/session-cache";
import { setSessionCookie } from "@/app/lib/session-cookie";
import {
  clearPendingTotpCookie,
  setPendingTotpCookie,
} from "@/app/lib/pending-totp";
import {
  accountFailures,
  addressFailures,
  clientAddress,
  tooManyAttempts,
} from "@/app/lib/rate-limit";

export async function POST(request: Request) {
  if (!process.env.ODOO_JSONRPC_HOST || !process.env.ODOO_JSONRPC_DATABASE) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  const body = await readJsonBody(request);
  if (!body) {
    return invalidBody();
  }
  const { username, password } = body;
  if (typeof username !== "string" || typeof password !== "string") {
    return NextResponse.json(
      { error: "Username and password are required" },
      { status: 400 }
    );
  }

  const addressKey = clientAddress(request);
  const accountKey = username.trim().toLowerCase();
  const wait = Math.max(
    addressFailures.retryAfter(addressKey),
    accountFailures.retryAfter(accountKey)
  );
  if (wait > 0) {
    return tooManyAttempts(wait);
  }

  try {
    const { sessionId, result, session } =
      await createOdooClient().authenticate({
        database: process.env.ODOO_JSONRPC_DATABASE,
        username,
        password,
      });

    accountFailures.reset(accountKey);

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
        console.warn("[Login] No backend_ids returned from initialize_web");
      }
    } catch (error) {
      console.error("[Login] Failed to initialize WhatsApp backend:", error);
      // Failed to initialize WhatsApp backend - not critical for login
    }

    const response = NextResponse.json({ user: result, backend });
    setSessionCookie(response, sessionId);
    clearPendingTotpCookie(response);
    return response;
  } catch (error) {
    const err = error as Error & {
      code?: number;
      data?: { name?: string; message?: string };
    };

    if (err.data?.name === "odoo.exceptions.AccessDenied") {
      addressFailures.fail(addressKey);
      accountFailures.fail(accountKey);
      return NextResponse.json(
        { error: err.data.message || "Wrong login/password" },
        { status: 401 }
      );
    }
    console.error("[Login] Sign-in failed:", error);
    return NextResponse.json(
      { error: "Unable to authenticate with Odoo" },
      { status: 500 }
    );
  }
}
