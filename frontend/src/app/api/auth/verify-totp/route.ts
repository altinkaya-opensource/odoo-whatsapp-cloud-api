import { NextResponse, type NextRequest } from "next/server";
import { createOdooClient } from "@/app/lib/odoo/server";
import {
  clearPendingTotpCookie,
  isValidOdooSessionId,
  PENDING_TOTP_COOKIE,
} from "@/app/lib/pending-totp";
import { sessionCache } from "@/app/lib/session-cache";
import { setSessionCookie } from "@/app/lib/session-cookie";
import {
  accountFailures,
  addressFailures,
  clientAddress,
  tooManyAttempts,
} from "@/app/lib/rate-limit";

type WhatsAppBackend = {
  backend_id?: number;
  backend_ids?: number[];
  user_id?: number;
  language?: string;
  company_id?: number;
  users?: Array<{ id: number; name: string; image_url?: string }>;
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

  // Six digits: a few guesses per sign-in, and per client
  const addressKey = clientAddress(request);
  const signInKey = `totp:${pendingSessionId}`;
  const wait = Math.max(
    addressFailures.retryAfter(addressKey),
    accountFailures.retryAfter(signInKey)
  );
  if (wait > 0) {
    return tooManyAttempts(wait);
  }

  try {
    const { sessionId, result, session } = await createOdooClient().verifyTotp(
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

    const response = NextResponse.json({ user: result, backend });
    setSessionCookie(response, sessionId);
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
      addressFailures.fail(addressKey);
      accountFailures.fail(signInKey);
      return NextResponse.json({ error: "totp_invalid" }, { status: 401 });
    }

    console.error("[VerifyTotp] TOTP verification failed:", error);
    return NextResponse.json({ error: "totp_unavailable" }, { status: 503 });
  }
}
