import { NextRequest } from "next/server";
import { eventBroadcaster } from "@/app/lib/events/broadcaster";
import { sessionCache } from "@/app/lib/session-cache";

const ensureEnv = () => {
  // No Odoo connection required - we use cached backend_ids
};

type SSEUpdate = {
  type: "threads" | "messages" | "heartbeat" | "sync_required";
  data?: {
    threads?: unknown[];
    messages?: unknown[];
    threadId?: string;
  };
  timestamp: number;
};

const HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds

// Simple rate limiting - in production use Redis or proper rate limiting
const activeConnections = new Map<string, number>();

export async function GET(request: NextRequest) {
  try {
    ensureEnv();
  } catch (error) {
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "Server configuration error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Get URL parameters
  const url = new URL(request.url);
  const sessionId =
    request.headers.get("x-session-id") || url.searchParams.get("sessionId");

  if (!sessionId) {
    return new Response(JSON.stringify({ error: "Missing Odoo session id" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const threadId = url.searchParams.get("threadId");

  // Get user's allowed backends from server-side cache (populated during auth)
  const allowedBackendIds = sessionCache.get(sessionId);

  if (!allowedBackendIds) {
    console.warn(
      "[SSE] Rejected connection: session not in cache (expired or invalid)"
    );
    return new Response(
      JSON.stringify({
        error: "Invalid or expired session ID. Please log in again.",
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  if (allowedBackendIds.length === 0) {
    console.warn("[SSE] Rejected connection: session has no backend access");
    return new Response(
      JSON.stringify({
        error: "No WhatsApp backends available for this user",
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  console.log(
    `[SSE] Connection authorized for backends: [${allowedBackendIds.join(", ")}]`
  );

  // Simple connection limiting
  const connectionKey = `${sessionId}-${threadId || "global"}`;
  const currentConnections = activeConnections.get(connectionKey) || 0;

  if (currentConnections >= 3) {
    // Max 3 connections per session+thread
    return new Response(
      JSON.stringify({ error: "Too many active connections for this session" }),
      {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Track connection
  activeConnections.set(connectionKey, currentConnections + 1);

  const encoder = new TextEncoder();
  // The counter is incremented above, so every exit path below has to run
  // exactly one cleanup or the session locks itself out at 3 connections.
  const decrementConnection = () => {
    const connections = activeConnections.get(connectionKey) || 1;
    if (connections <= 1) {
      activeConnections.delete(connectionKey);
    } else {
      activeConnections.set(connectionKey, connections - 1);
    }
  };
  let releaseConnection = decrementConnection;

  const stream = new ReadableStream({
    start(controller) {
      const sendSSEMessage = (update: SSEUpdate) => {
        const message = `data: ${JSON.stringify(update)}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      console.log(
        `[SSE] Client connected: ${connectionKey} (total connections: ${activeConnections.get(connectionKey)})`
      );

      // Send initial heartbeat
      const initialTimestamp = Date.now();
      sendSSEMessage({ type: "heartbeat", timestamp: initialTimestamp });

      // Subscribe to webhook events via EventBroadcaster with backend access control
      const threadsChannel = "threads";
      const messagesChannel = threadId ? `messages:${threadId}` : "messages";

      const listenerMetadata = {
        allowedBackendIds,
        sessionId,
      };

      // Thread events listener
      const unsubscribeThreads = eventBroadcaster.subscribe(
        threadsChannel,
        (data) => {
          const update = data as SSEUpdate;
          sendSSEMessage(update);
        },
        listenerMetadata
      );

      // Message events listener
      const unsubscribeMessages = eventBroadcaster.subscribe(
        messagesChannel,
        (data) => {
          const update = data as SSEUpdate;
          sendSSEMessage(update);
        },
        listenerMetadata
      );

      console.log(
        `[SSE] Subscribed to channels: ${threadsChannel}, ${messagesChannel}`
      );

      // Heartbeat
      let lastHeartbeat = Date.now();
      let heartbeatCount = 0;

      const sendHeartbeat = () => {
        const now = Date.now();

        // Send heartbeat
        if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
          heartbeatCount++;
          sendSSEMessage({ type: "heartbeat", timestamp: now });
          lastHeartbeat = now;

          // Touch session cache to prevent expiration while user is connected
          // This keeps the session alive as long as SSE connection is active
          sessionCache.touch(sessionId);

          // Note: Drift detection removed to eliminate Odoo RPC dependency
          // Webhooks are the primary sync mechanism; clients should handle
          // sync_required events if webhooks fail
        }
      };

      // Start heartbeat interval
      const heartbeatIntervalId = setInterval(
        sendHeartbeat,
        HEARTBEAT_INTERVAL_MS
      );

      // Cleanup on connection close - safe to call more than once
      let isCleanedUp = false;
      const cleanup = () => {
        if (isCleanedUp) {
          return;
        }
        isCleanedUp = true;

        console.log(
          `[SSE] Client disconnected: ${connectionKey} (heartbeats sent: ${heartbeatCount})`
        );

        // Clear heartbeat interval
        clearInterval(heartbeatIntervalId);

        // Unsubscribe from webhook events
        unsubscribeThreads();
        unsubscribeMessages();

        decrementConnection();

        try {
          controller.close();
        } catch {
          // Connection already closed
        }
      };

      releaseConnection = cleanup;

      // Handle client disconnect. A request that was aborted before the
      // stream started never fires the event, so check the state too.
      request.signal.addEventListener("abort", cleanup);
      if (request.signal.aborted) {
        cleanup();
      }
    },
    cancel() {
      releaseConnection();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
