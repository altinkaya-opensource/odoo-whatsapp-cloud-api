import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { eventBroadcaster } from "@/app/lib/events/broadcaster";

/**
 * Webhook Event Types
 */
type WebhookEventType = "thread.created" | "thread.updated" | "message.created";

/**
 * Webhook Payload Structure
 */
type WebhookPayload = {
  event_type: WebhookEventType;
  data: unknown;
  thread_id?: number;
  timestamp: number;
};

/**
 * SSE Update Structure (matches existing format)
 */
type SSEUpdate = {
  type: "threads" | "messages";
  data: {
    threads?: unknown[];
    messages?: unknown[];
    threadId?: string;
  };
  timestamp: number;
};

/**
 * Rate limiting - simple in-memory implementation
 * For production, use Redis or external rate limiting service
 */
const requestCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 1000;

function checkRateLimit(identifier: string): boolean {
  const now = Date.now();
  const record = requestCounts.get(identifier);

  if (!record || now > record.resetAt) {
    // New window - drop stale keys so the map cannot grow without bound
    requestCounts.forEach((entry, key) => {
      if (now > entry.resetAt) {
        requestCounts.delete(key);
      }
    });
    requestCounts.set(identifier, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  record.count++;
  return true;
}

/**
 * Verify HMAC-SHA256 signature
 */
function verifySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  try {
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(payload);
    const expectedSignature = hmac.digest("hex");

    // Check length first to avoid timingSafeEqual error
    if (signature.length !== expectedSignature.length) {
      return false;
    }

    // Timing-safe comparison to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSignature, "hex")
    );
  } catch (error) {
    console.error("[Webhook] Signature verification error:", error);
    return false;
  }
}

/**
 * Webhook POST endpoint
 * Receives webhooks from Odoo backend and broadcasts to SSE clients
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // 1. Check webhook secret configuration
  const webhookSecret = process.env.ODOO_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[Webhook] ODOO_WEBHOOK_SECRET not configured");
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 }
    );
  }

  // 2. Rate limiting (by IP address)
  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  if (!checkRateLimit(clientIp)) {
    console.warn(`[Webhook] Rate limit exceeded for IP: ${clientIp}`);
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  // 3. Verify signature
  const signature = request.headers.get("x-odoo-signature");
  if (!signature) {
    console.warn("[Webhook] Missing signature header");
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  const rawBody = await request.text();
  if (!verifySignature(rawBody, signature, webhookSecret)) {
    console.warn("[Webhook] Invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // 4. Parse payload
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    console.error("[Webhook] Invalid JSON payload:", error);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 5. Validate payload structure
  if (
    !payload.event_type ||
    !payload.data ||
    typeof payload.timestamp !== "number"
  ) {
    console.error("[Webhook] Invalid payload structure:", payload);
    return NextResponse.json(
      { error: "Invalid payload structure" },
      { status: 400 }
    );
  }

  console.log(
    `[Webhook] Received: ${payload.event_type} (thread_id: ${payload.thread_id || "N/A"})`
  );

  // 6. Extract backend_id from payload for access control
  let backendId: number | undefined;
  try {
    const payloadData = payload.data as {
      backend_id?: number | [number, string] | false;
    };

    if (payloadData.backend_id) {
      // Handle both formats: number or [id, name] tuple
      backendId = Array.isArray(payloadData.backend_id)
        ? payloadData.backend_id[0]
        : typeof payloadData.backend_id === "number"
          ? payloadData.backend_id
          : undefined;
    }

  } catch (error) {
    console.error(`[Webhook] Failed to extract backend_id:`, error);
  }

  // Fail closed: without a backend id we cannot tell which sessions are
  // allowed to see this event, and broadcasting to everyone would leak
  // conversations across backends.
  if (backendId === undefined) {
    console.error(
      `[Webhook] Rejected ${payload.event_type}: payload carries no backend_id`
    );
    return NextResponse.json(
      { error: "Payload must include data.backend_id" },
      { status: 400 }
    );
  }

  // 7. Broadcast to SSE clients based on event type with backend access filtering
  let broadcastCount = 0;

  switch (payload.event_type) {
    case "thread.created":
    case "thread.updated": {
      // Broadcast thread events to global threads channel
      const sseUpdate: SSEUpdate = {
        type: "threads",
        data: {
          threads: [payload.data],
        },
        timestamp: payload.timestamp,
      };

      eventBroadcaster.broadcast("threads", sseUpdate, backendId);
      broadcastCount = eventBroadcaster.getListenerCount("threads");
      break;
    }

    case "message.created": {
      // Broadcast message events to both global and thread-specific channels
      const sseUpdate: SSEUpdate = {
        type: "messages",
        data: {
          messages: [payload.data],
          threadId: payload.thread_id?.toString(),
        },
        timestamp: payload.timestamp,
      };

      // Broadcast to global messages channel
      eventBroadcaster.broadcast("messages", sseUpdate, backendId);
      const globalCount = eventBroadcaster.getListenerCount("messages");

      // Broadcast to thread-specific channel if thread_id is present
      let threadCount = 0;
      if (payload.thread_id) {
        const threadChannel = `messages:${payload.thread_id}`;
        eventBroadcaster.broadcast(threadChannel, sseUpdate, backendId);
        threadCount = eventBroadcaster.getListenerCount(threadChannel);
      }

      broadcastCount = globalCount + threadCount;
      break;
    }

    default:
      console.warn(`[Webhook] Unknown event type: ${payload.event_type}`);
      return NextResponse.json(
        { error: "Unknown event type" },
        { status: 400 }
      );
  }

  const processingTime = Date.now() - startTime;
  console.log(
    `[Webhook] Processed ${payload.event_type} in ${processingTime}ms, broadcasted to ${broadcastCount} listeners`
  );

  return NextResponse.json({
    success: true,
    event_type: payload.event_type,
    listeners: broadcastCount,
    processing_time_ms: processingTime,
  });
}

/**
 * Health check endpoint
 */
export async function GET() {
  const activeChannels = eventBroadcaster.getActiveChannels();
  const totalListeners = eventBroadcaster.getTotalListenerCount();

  return NextResponse.json({
    status: "ok",
    active_channels: activeChannels.length,
    total_listeners: totalListeners,
    channels: activeChannels.map((channel) => ({
      name: channel,
      listeners: eventBroadcaster.getListenerCount(channel),
    })),
  });
}
